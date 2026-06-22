import { createHash, randomInt } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, relative, resolve, sep } from "node:path";
import {
  appendLedgerEntry,
  canonicalJson,
  computeRunKey,
  ensureStore,
  hashSpec,
  type LedgerDiagnostics,
  type LedgerEntry,
  latestOkEntry,
  makeRunId,
  parseSamples,
  parseSpec,
  type ResolvedSpec,
  readLedger,
  resolveData,
  runDir,
  type Spec,
  SpecSchema,
  serializeSpecToml,
  storeDirFor,
  updateLedgerEntry,
} from "@mcmcjs/core";
import { createFitRunner, type EngineContext } from "@mcmcjs/engine";
import {
  ensureProject,
  managedProjectDir,
  type PackagePins,
  resolveVersion,
  runFitAuto,
  validatePins,
  validateVersionString,
} from "@mcmcjs/julia";
import type { Command } from "commander";
import pc from "picocolors";
import { ZodError } from "zod";
import { convertGraph } from "./convert";
import { buildDiagnosticsReport, type DiagnosticsReport, formatReportHuman } from "./diagnose";
import { backendLabel, formatFitResult } from "./fit";
import { installRunner, juliaupBin } from "./julia";
import { parseFloatOption, parseIntOption } from "./options";
import { rendererFor } from "./progress";
import { timeAgo } from "./store-cli";

const INSTALL_TIMEOUT_MS = 30 * 60_000;
const MAX_SEED = 2_147_483_647;

/** Guess the PPL from the model source; undefined when neither marker is found. */
export function detectBackend(source: string): "turing" | "juliabugs" | undefined {
  if (/\bJuliaBUGS\b/.test(source)) return "juliabugs";
  if (/@model\b|\busing Turing\b/.test(source)) return "turing";
  return undefined;
}

type InputKind = "spec" | "model" | "graph";

function classifyInput(path: string): InputKind {
  const ext = extname(path).toLowerCase();
  if (ext === ".toml") return "spec";
  if (ext === ".jl") return "model";
  if (ext === ".json") {
    let doc: unknown;
    try {
      doc = JSON.parse(readFileSync(path, "utf8"));
    } catch (err) {
      throw new Error(`invalid JSON in ${path}: ${err instanceof Error ? err.message : err}`);
    }
    if (doc && typeof doc === "object" && ("elements" in doc || "graphJSON" in doc)) {
      return "graph";
    }
    return "spec";
  }
  throw new Error(`unsupported input (expected a .toml/.json spec, .jl model, or graph): ${path}`);
}

export interface RunCliOptions {
  data?: string;
  out?: string;
  draws?: number;
  warmup?: number;
  chains?: number;
  seed?: number;
  adaptDelta?: number;
  backend?: string;
  entry?: string;
  refit?: boolean;
  store?: string;
  daemon?: boolean;
  package?: string[];
  verbose?: boolean;
  juliaVersion?: string;
  json?: boolean;
}

/** Parses repeated `name=version` flags into a pins record, or undefined when none. */
export function parsePackagePins(flags: string[] | undefined): PackagePins | undefined {
  if (!flags || flags.length === 0) return undefined;
  const pins: PackagePins = {};
  for (const flag of flags) {
    const at = flag.indexOf("=");
    if (at <= 0 || at === flag.length - 1) {
      throw new Error(`--package expects name=version, got "${flag}"`);
    }
    const name = flag.slice(0, at).trim();
    const version = flag.slice(at + 1).trim();
    validateVersionString(name, version);
    pins[name] = version;
  }
  return pins;
}

/** Merges flag pins over any spec pins (flags win); undefined when the result is empty. */
export function mergePins(
  specPins: PackagePins | undefined,
  flagPins: PackagePins | undefined,
): PackagePins | undefined {
  const merged = { ...specPins, ...flagPins };
  return Object.keys(merged).length > 0 ? merged : undefined;
}

function validated(spec: Record<string, unknown>): Spec {
  try {
    return SpecSchema.parse(spec);
  } catch (error) {
    if (error instanceof ZodError) {
      const detail = error.issues
        .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
        .join("; ");
      throw new Error(`invalid run settings: ${detail}`);
    }
    throw error;
  }
}

/** Layers CLI flags over a spec; flags always win. */
function applyOverrides(spec: Spec, opts: RunCliOptions): Spec {
  return validated({
    ...spec,
    ...(opts.seed !== undefined ? { seed: opts.seed } : {}),
    backend: { ...spec.backend, ...(opts.backend ? { id: opts.backend } : {}) },
    model: { ...spec.model, ...(opts.entry ? { entry: opts.entry } : {}) },
    sampler: {
      ...spec.sampler,
      ...(opts.draws !== undefined ? { draws: opts.draws } : {}),
      ...(opts.warmup !== undefined ? { warmup: opts.warmup } : {}),
      ...(opts.chains !== undefined ? { chains: opts.chains } : {}),
      ...(opts.adaptDelta !== undefined ? { adapt_delta: opts.adaptDelta } : {}),
    },
  });
}

/** The effective data-file reference: a --data override wins over a spec's data_file. */
function dataFileFor(opts: RunCliOptions, specDataFile?: string): string | undefined {
  return opts.data ? resolve(opts.data) : specDataFile;
}

/** A sibling data file conventionally paired with a bare model, when one exists. */
export function autoDetectDataFile(modelPath: string): string | undefined {
  const dir = dirname(modelPath);
  const base = basename(modelPath, extname(modelPath));
  for (const name of [`${base}.csv`, "data.csv", "data.json"]) {
    const candidate = join(dir, name);
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

export interface RunConfig {
  spec: Spec;
  /** Absolute path to the model file that will run. */
  modelPath: string;
  /** The juliaup channel the fit runs on. */
  channel: string;
  /** Absolute path to a referenced data file, when the data is not inline. */
  dataFile?: string;
  specSource: "input" | "sibling" | "defaults";
  notes: string[];
}

/**
 * Resolves what to run: defaults, then an optional spec file (the input itself
 * or a sibling `<model>.toml` the user authored), then flags. Never scaffolds.
 */
export function buildRunConfig(inputPath: string, opts: RunCliOptions): RunConfig {
  const kind = classifyInput(inputPath);
  const notes: string[] = [];

  if (kind === "graph") {
    for (const flag of ["data", "backend", "entry"] as const) {
      if (opts[flag] !== undefined) {
        throw new Error(`--${flag} does not apply to a graph; it carries its own data and model`);
      }
    }
    const specPath = `${inputPath.replace(/\.json$/i, "")}.toml`;
    if (!existsSync(specPath)) {
      const result = convertGraph(inputPath, undefined, opts.seed ?? randomInt(0, MAX_SEED), {
        draws: opts.draws ?? 1000,
        warmup: opts.warmup ?? 1000,
        chains: opts.chains ?? 4,
      });
      notes.push(`converted ${basename(inputPath)} -> ${result.modelPath}`);
      notes.push(`wrote ${result.specPath}`);
    } else {
      notes.push(`using settings from ${specPath}; flags override`);
    }
    const config = fromSpecFile(specPath, opts);
    return { ...config, notes: [...notes, ...config.notes] };
  }

  if (kind === "spec") return fromSpecFile(inputPath, opts);

  const modelPath = resolve(inputPath);
  const sibling = join(dirname(modelPath), `${basename(modelPath, extname(modelPath))}.toml`);
  if (existsSync(sibling)) {
    const config = fromSpecFile(sibling, opts);
    // The model named on the command line wins over the spec's model.path.
    const spec = validated({
      ...config.spec,
      model: { ...config.spec.model, path: `./${basename(modelPath)}` },
    });
    return {
      spec,
      modelPath,
      channel: config.channel,
      dataFile: config.dataFile,
      specSource: "sibling",
      notes: [`using settings from ${sibling}; flags override`],
    };
  }

  const source = readFileSync(modelPath, "utf8");
  const backend = (opts.backend as "turing" | "juliabugs" | undefined) ?? detectBackend(source);
  if (!backend) {
    throw new Error(
      `could not detect the backend from ${inputPath}; pass --backend turing|juliabugs`,
    );
  }
  const spec = validated({
    schema_version: "0",
    seed: opts.seed ?? randomInt(0, MAX_SEED),
    backend: { id: backend },
    model: {
      kind: "file",
      path: `./${basename(modelPath)}`,
      ...(opts.entry ? { entry: opts.entry } : {}),
    },
    sampler: {
      algorithm: "NUTS",
      draws: opts.draws ?? 1000,
      warmup: opts.warmup ?? 1000,
      chains: opts.chains ?? 4,
      ...(opts.adaptDelta !== undefined ? { adapt_delta: opts.adaptDelta } : {}),
    },
  });
  // With no spec and no --data, fall back to a sibling data file (e.g. data.csv
  // next to the model) so the bare `mcmc run model.jl` works; --data still wins.
  let dataFile = dataFileFor(opts);
  if (!dataFile) {
    const detected = autoDetectDataFile(modelPath);
    if (detected) {
      dataFile = detected;
      notes.push(`using data from ${displayPath(detected)} (pass --data to override)`);
    }
  }
  return {
    spec,
    modelPath,
    channel: opts.juliaVersion ?? spec.backend.version,
    dataFile,
    specSource: "defaults",
    notes,
  };
}

function fromSpecFile(specPath: string, opts: RunCliOptions): RunConfig {
  const parsed = parseSpec(specPath);
  const spec = applyOverrides(parsed, opts);
  return {
    spec,
    modelPath: parsed.modelPath,
    channel: opts.juliaVersion ?? spec.backend.version,
    dataFile: dataFileFor(opts, parsed.dataFilePath),
    specSource: "input",
    notes: [],
  };
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function finiteOrNull(values: number[], pick: (vs: number[]) => number): number | null {
  const finite = values.filter((v) => Number.isFinite(v));
  return finite.length > 0 ? pick(finite) : null;
}

/** Condenses a diagnostics report into the summary cached in the ledger. */
export function diagnosticsSummary(report: DiagnosticsReport): LedgerDiagnostics {
  return {
    converged: report.converged,
    rhat_max: finiteOrNull(
      report.variables.map((v) => v.rhat),
      (vs) => Math.max(...vs),
    ),
    ess_bulk_min: finiteOrNull(
      report.variables.map((v) => v.essBulk),
      (vs) => Math.min(...vs),
    ),
    ess_tail_min: finiteOrNull(
      report.variables.map((v) => v.essTail),
      (vs) => Math.min(...vs),
    ),
    divergences: report.divergences,
  };
}

/** The spec frozen into the run dir: effective channel, model path pointing at the snapshot. */
export function frozenSpecFor(
  spec: Spec,
  channel: string,
  modelFileName: string,
  dataFile?: string,
): Spec {
  const frozen: Spec = {
    ...spec,
    backend: { ...spec.backend, version: channel },
    model: { ...spec.model, path: `./${modelFileName}` },
  };
  // A referenced data file is recorded by path, not inlined into the frozen spec.
  if (dataFile) return { ...frozen, data: {}, data_file: dataFile };
  return frozen;
}

/**
 * Whether a prior same-key run can be reused. A seed is "pinned" when it was
 * given explicitly (--seed or any spec file); a pinned seed must match.
 */
export function canReuse(
  prior: LedgerEntry | undefined,
  seed: number,
  seedPinned: boolean,
): boolean {
  if (!prior) return false;
  return !seedPinned || prior.seed === seed;
}

export interface RunInputs {
  model_sha256: string;
  data_sha256: string;
  sampler: LedgerEntry["sampler"];
  channel: string;
  seed: number;
}

/** What changed versus a previous run of the same model, for the refit message. */
export function refitReasons(prev: LedgerEntry, next: RunInputs, seedPinned: boolean): string[] {
  const reasons: string[] = [];
  if (prev.model_sha256 !== next.model_sha256) reasons.push("the model changed");
  if (prev.data_sha256 !== next.data_sha256) reasons.push("the data changed");
  for (const field of ["draws", "warmup", "chains", "adapt_delta"] as const) {
    if (prev.sampler[field] !== next.sampler[field]) {
      reasons.push(`${field} ${prev.sampler[field]} -> ${next.sampler[field]}`);
    }
  }
  if (prev.backend.version !== next.channel) {
    reasons.push(`julia ${prev.backend.version} -> ${next.channel}`);
  }
  if (seedPinned && prev.seed !== next.seed) reasons.push(`seed ${prev.seed} -> ${next.seed}`);
  return reasons;
}

function fitBanner(config: RunConfig, juliaLabel: string): string {
  const s = config.spec.sampler;
  const backend = backendLabel(config.spec.backend.id);
  return `Fitting ${basename(config.modelPath)} with ${backend} (${s.algorithm}, ${s.chains} chains x ${s.draws} draws + ${s.warmup} warmup, seed ${config.spec.seed}) on Julia ${juliaLabel}...`;
}

function displayPath(path: string): string {
  const rel = relative(process.cwd(), path);
  return rel === "" ? "." : rel.startsWith("..") ? path : rel;
}

export function registerRun(program: Command, ctx: EngineContext): void {
  program
    .command("run")
    .summary("full workflow: fit, diagnose, record a run")
    .helpGroup("Run inference:")
    .argument("<input>", "model file (.jl), spec file (.toml/.json), or DoodleBUGS graph (.json)")
    .description("Run the whole workflow: fit, diagnose, and record the run in the project store")
    .option("--data <file>", "data file (.json object or .csv columns)")
    .option("-o, --out <file>", "also export the samples file to this path")
    .option("--draws <n>", "posterior draws (default 1000)", parseIntOption)
    .option("--warmup <n>", "warmup iterations (default 1000)", parseIntOption)
    .option("--chains <n>", "number of chains (default 4)", parseIntOption)
    .option("--adapt-delta <x>", "NUTS target acceptance rate (default 0.8)", parseFloatOption)
    .option("--seed <n>", "random seed (default: drawn fresh and recorded)", parseIntOption)
    .option("--backend <id>", "backend (default: detected from the model)")
    .option("--entry <name>", "model entry function (default build_model)")
    .option("--refit", "fit even when nothing changed since the last run")
    .option("--daemon", "fit through a persistent Julia worker (or set MCMC_DAEMON=1)")
    .option("--verbose", "show the full raw install/precompile output, not a collapsed spinner")
    .option(
      "--package <name=version>",
      "pin a managed package version (repeatable, e.g. --package Turing=0.45)",
      (value, prev: string[]) => [...prev, value],
      [],
    )
    .option("--store <dir>", "run store directory (default: nearest .mcmc, or beside the model)")
    .option("--julia-version <channel>", "Julia version/channel to run (overrides the spec)")
    .option("--json", "print results as JSON")
    .addHelpText(
      "after",
      "\nExit codes: 0 = converged, 1 = error, 2 = ran but not converged." +
        "\nArtifacts go to the hidden .mcmc/ store; inspect with `mcmc runs` and `mcmc show`," +
        "\nmaterialize files with `mcmc export`. Settings come from flags (always honored)" +
        "\nover an optional spec file. An unchanged model+data+settings reuses the last run.",
    )
    .action(async (input: string, opts: RunCliOptions) => {
      const say = (line: string) => {
        if (!opts.json) process.stdout.write(`${line}\n`);
      };
      const inputPath = resolve(input);
      const config = buildRunConfig(inputPath, opts);
      for (const note of config.notes) say(note);

      // Fail clearly on a missing data file (a --data typo or a stale data_file)
      // rather than letting the loader throw a raw ENOENT mid-run.
      if (config.dataFile && !existsSync(config.dataFile)) {
        throw new Error(`data file not found: ${displayPath(config.dataFile)}`);
      }

      // Flag pins win over spec pins; the effective pins are recorded in the run.
      const pins = mergePins(config.spec.backend.packages, parsePackagePins(opts.package));
      validatePins(pins); // fail fast on a bad spec/flag pin
      if (pins) config.spec.backend.packages = pins;
      else delete config.spec.backend.packages;

      // A referenced data file is loaded for the fit but recorded by path + hash,
      // not inlined into the spec or the store.
      const resolvedData = resolveData(config.spec.data, config.dataFile);
      config.spec.data = resolvedData.data;

      const storeDir = storeDirFor(config.modelPath, opts.store ?? process.env.MCMC_STORE);
      ensureStore(storeDir);

      const modelSource = readFileSync(config.modelPath, "utf8");
      const inputs: RunInputs = {
        model_sha256: sha256(modelSource),
        data_sha256: resolvedData.dataSha256 ?? sha256(canonicalJson(config.spec.data)),
        sampler: config.spec.sampler,
        channel: config.channel,
        seed: config.spec.seed,
      };
      const runKey = computeRunKey({
        backend: { id: config.spec.backend.id, version: config.channel },
        model_sha256: inputs.model_sha256,
        entry: config.spec.model.entry,
        sampler: config.spec.sampler,
        data_sha256: inputs.data_sha256,
        packages: pins,
      });
      const seedPinned = opts.seed !== undefined || config.specSource !== "defaults";
      const modelRel = relative(dirname(storeDir), config.modelPath).split(sep).join("/");

      const finish = (
        report: DiagnosticsReport,
        runId: string,
        cached: boolean,
        fit: unknown,
        spec: Spec,
      ): void => {
        const dir = runDir(storeDir, runId);
        if (opts.out) {
          try {
            copyFileSync(join(dir, "samples.json"), resolve(opts.out));
            say(`exported samples to ${opts.out}`);
          } catch (error) {
            process.stderr.write(
              `warning: could not export samples to ${opts.out}: ${(error as Error).message}\n`,
            );
          }
        }
        if (opts.json) {
          const payload = { run: { id: runId, dir, cached }, spec, fit: fit ?? null, report };
          process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
        } else {
          process.stdout.write(formatReportHuman(report));
        }
        process.exitCode = report.converged ? 0 : 2;
      };

      const ledger = readLedger(storeDir);
      if (!opts.refit) {
        const prior = latestOkEntry(ledger, runKey);
        if (canReuse(prior, config.spec.seed, seedPinned) && prior) {
          const samplesPath = join(runDir(storeDir, prior.id), "samples.json");
          if (existsSync(samplesPath)) {
            say(
              `unchanged since run ${prior.id} (${timeAgo(prior.started_at)}); reusing (--refit to force)`,
            );
            say("");
            finish(
              buildDiagnosticsReport(parseSamples(readFileSync(samplesPath, "utf8"))),
              prior.id,
              true,
              null,
              { ...config.spec, seed: prior.seed },
            );
            return;
          }
        }
      }

      const previous = [...ledger.runs]
        .reverse()
        .find((e) => e.status === "ok" && e.model_path === modelRel);
      if (previous) {
        const reasons = refitReasons(previous, inputs, seedPinned);
        if (reasons.length > 0) say(`refitting: ${reasons.join(", ")} since run ${previous.id}`);
      }

      const bin = await juliaupBin(ctx);
      const resolved = await resolveVersion(bin, config.channel, ctx.run);
      const projectDir = managedProjectDir(resolved.version, pins);
      await ensureProject(
        resolved.command,
        installRunner({
          label: "preparing the Julia environment",
          timeoutMs: INSTALL_TIMEOUT_MS,
          json: opts.json,
          verbose: opts.verbose,
        }),
        projectDir,
        pins,
      );

      say(fitBanner(config, resolved.version ?? `channel "${config.channel}"`));

      const startedAt = new Date();
      let runId = makeRunId(startedAt, runKey);
      for (let n = 2; existsSync(runDir(storeDir, runId)); n += 1) {
        runId = `${makeRunId(startedAt, runKey)}-${n}`;
      }
      const dir = runDir(storeDir, runId);
      mkdirSync(dir, { recursive: true });

      // Snapshot the inputs before fitting so even a failed run is debuggable.
      // The frozen spec references a data file by path; the spec the fit runs
      // on keeps the loaded data so the model still receives it.
      const frozen = frozenSpecFor(
        config.spec,
        config.channel,
        basename(config.modelPath),
        config.dataFile,
      );
      const specHash = hashSpec(frozen);
      writeFileSync(join(dir, basename(config.modelPath)), modelSource);
      writeFileSync(join(dir, "spec.toml"), serializeSpecToml(frozen));

      const resolvedSpec: ResolvedSpec = {
        ...frozen,
        data: config.spec.data,
        specPath: join(dir, "spec.toml"),
        modelPath: config.modelPath,
        specHash,
      };
      const progress = rendererFor(opts.json, backendLabel(config.spec.backend.id));
      let fit: Awaited<ReturnType<typeof runFitAuto>>;
      try {
        fit = await runFitAuto(resolvedSpec, resolved, {
          spawn: createFitRunner(),
          projectDir,
          outPath: join(dir, "samples.json"),
          recordPath: join(dir, "run.json"),
          onProgress: progress.onProgress,
          daemon: opts.daemon ?? process.env.MCMC_DAEMON === "1",
          notify: (line) => say(line),
          dataFile: config.dataFile,
          dataSha256: resolvedData.dataSha256,
        });
      } finally {
        progress.finish();
      }

      const entry: LedgerEntry = {
        id: runId,
        run_key: runKey,
        spec_hash: specHash,
        status: fit.status === "ok" ? "ok" : "failed",
        model_path: modelRel,
        model_sha256: inputs.model_sha256,
        data_sha256: inputs.data_sha256,
        seed: config.spec.seed,
        backend: { id: config.spec.backend.id, version: config.channel },
        sampler: config.spec.sampler,
        julia: fit.status === "ok" ? fit.runtimeActual : resolved.version,
        started_at: startedAt.toISOString(),
        elapsed_ms: fit.elapsedMs,
      };

      if (fit.status !== "ok") {
        appendLedgerEntry(storeDir, { ...entry, error: fit.error });
        if (opts.json) {
          process.stdout.write(
            `${JSON.stringify({ run: { id: runId, dir, cached: false }, fit }, null, 2)}\n`,
          );
        } else {
          process.stdout.write(`${formatFitResult(fit, config.channel, join(dir, "run.json"))}\n`);
          // A data-field error with no data provided almost always means the
          // model needs data nobody passed; point at the fix instead of the raw error.
          const noData = !config.dataFile && Object.keys(config.spec.data).length === 0;
          if (noData && /has no field|NamedTuple has no fields/i.test(fit.error ?? "")) {
            const detected = autoDetectDataFile(config.modelPath);
            process.stdout.write(
              `${pc.dim(
                detected
                  ? `hint: this model needs data; try: mcmc run ${basename(config.modelPath)} --data ${displayPath(detected)}`
                  : "hint: this model reads data fields, but no --data or [data] block was provided",
              )}\n`,
            );
          }
        }
        process.exitCode = 1;
        return;
      }

      // Record the run before diagnostics so a late failure cannot orphan it.
      appendLedgerEntry(storeDir, entry);
      const samples = parseSamples(readFileSync(join(dir, "samples.json"), "utf8"));
      const report = buildDiagnosticsReport(samples);
      updateLedgerEntry(storeDir, { ...entry, diagnostics: diagnosticsSummary(report) });

      say(
        `${pc.green("ok:")} run ${runId} (${(fit.elapsedMs / 1000).toFixed(1)} s, Julia ${fit.runtimeActual ?? config.channel}) saved to ${displayPath(storeDir)}`,
      );
      say("");
      finish(report, runId, false, fit, frozen);
    });
}
