import { createHash, randomInt } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
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
  runDir,
  type Spec,
  SpecSchema,
  serializeSpecToml,
  storeDirFor,
} from "@mcmcjs/core";
import { createFitRunner, createRunner, type EngineContext } from "@mcmcjs/engine";
import { ensureProject, managedProjectReady, resolveVersion, runFit } from "@mcmcjs/julia";
import type { Command } from "commander";
import pc from "picocolors";
import { ZodError } from "zod";
import { convertGraph } from "./convert";
import { loadDataFile } from "./data-file";
import { buildDiagnosticsReport, type DiagnosticsReport, formatReportHuman } from "./diagnose";
import { formatFitResult } from "./fit";
import { juliaupBin } from "./julia";
import { timeAgo } from "./store-cli";

const INSTALL_TIMEOUT_MS = 30 * 60_000;
const MAX_SEED = 2_147_483_647;

const BACKEND_NAMES: Record<string, string> = { turing: "Turing.jl", juliabugs: "JuliaBUGS" };

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
  juliaVersion?: string;
  json?: boolean;
}

function parseIntOption(value: string): number {
  const n = Number.parseInt(value, 10);
  if (!Number.isInteger(n)) throw new Error(`expected an integer, got "${value}"`);
  return n;
}

function parseFloatOption(value: string): number {
  const n = Number.parseFloat(value);
  if (!Number.isFinite(n)) throw new Error(`expected a number, got "${value}"`);
  return n;
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
    ...(opts.data ? { data: loadDataFile(opts.data) } : {}),
  });
}

export interface RunConfig {
  spec: Spec;
  /** Absolute path to the model file that will run. */
  modelPath: string;
  /** The juliaup channel the fit runs on. */
  channel: string;
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
    data: opts.data ? loadDataFile(opts.data) : {},
  });
  return {
    spec,
    modelPath,
    channel: opts.juliaVersion ?? spec.backend.version,
    specSource: "defaults",
    notes: [],
  };
}

function fromSpecFile(specPath: string, opts: RunCliOptions): RunConfig {
  const parsed = parseSpec(specPath);
  const spec = applyOverrides(parsed, opts);
  return {
    spec,
    modelPath: parsed.modelPath,
    channel: opts.juliaVersion ?? spec.backend.version,
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

function fitBanner(config: RunConfig, juliaLabel: string): string {
  const s = config.spec.sampler;
  const backend = BACKEND_NAMES[config.spec.backend.id] ?? config.spec.backend.id;
  return `Fitting ${basename(config.modelPath)} with ${backend} (${s.algorithm}, ${s.chains} chains x ${s.draws} draws + ${s.warmup} warmup, seed ${config.spec.seed}) on Julia ${juliaLabel}...`;
}

function displayPath(path: string): string {
  const rel = relative(process.cwd(), path);
  return rel === "" ? "." : rel.startsWith("..") ? path : rel;
}

export function registerRun(program: Command, ctx: EngineContext): void {
  program
    .command("run")
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

      const storeDir = storeDirFor(config.modelPath, opts.store);
      ensureStore(storeDir);

      const modelSource = readFileSync(config.modelPath, "utf8");
      const modelSha = sha256(modelSource);
      const dataSha = sha256(canonicalJson(config.spec.data));
      const runKey = computeRunKey({
        backend: { id: config.spec.backend.id, version: config.channel },
        model_sha256: modelSha,
        entry: config.spec.model.entry,
        sampler: config.spec.sampler,
        data_sha256: dataSha,
      });

      const finish = (
        report: DiagnosticsReport,
        runId: string,
        cached: boolean,
        fit?: unknown,
      ): void => {
        const dir = runDir(storeDir, runId);
        if (opts.out) {
          copyFileSync(join(dir, "samples.json"), resolve(opts.out));
          say(`exported samples to ${opts.out}`);
        }
        if (opts.json) {
          const payload = { run: { id: runId, dir, cached }, spec: config.spec, fit, report };
          process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
        } else {
          process.stdout.write(formatReportHuman(report));
        }
        process.exitCode = report.converged ? 0 : 2;
      };

      if (!opts.refit) {
        const prior = latestOkEntry(readLedger(storeDir), runKey);
        if (prior && (opts.seed === undefined || prior.seed === opts.seed)) {
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
            );
            return;
          }
        }
      }

      const bin = await juliaupBin(ctx);
      const resolved = await resolveVersion(bin, config.channel, ctx.run);
      if (!opts.json && !managedProjectReady()) {
        say("Preparing the Julia environment (first run can take a few minutes)...");
      }
      const projectDir = await ensureProject(resolved.command, createRunner(INSTALL_TIMEOUT_MS));

      say(fitBanner(config, resolved.version ?? `channel "${config.channel}"`));

      const startedAt = new Date();
      const runId = makeRunId(startedAt, runKey);
      const dir = runDir(storeDir, runId);
      mkdirSync(dir, { recursive: true });

      const resolvedSpec: ResolvedSpec = {
        ...config.spec,
        specPath: join(dir, "spec.toml"),
        modelPath: config.modelPath,
        specHash: hashSpec(config.spec),
      };
      const fit = await runFit(resolvedSpec, resolved, {
        spawn: createFitRunner(),
        projectDir,
        outPath: join(dir, "samples.json"),
        recordPath: join(dir, "run.json"),
      });

      const entry: LedgerEntry = {
        id: runId,
        run_key: runKey,
        spec_hash: resolvedSpec.specHash,
        status: fit.status === "ok" ? "ok" : "failed",
        model_path: relative(dirname(storeDir), config.modelPath),
        model_sha256: modelSha,
        data_sha256: dataSha,
        seed: config.spec.seed,
        backend: { id: config.spec.backend.id, version: config.channel },
        sampler: config.spec.sampler,
        julia: fit.status === "ok" ? fit.runtimeActual : resolved.version,
        started_at: startedAt.toISOString(),
        elapsed_ms: fit.elapsedMs,
      };

      if (fit.status !== "ok") {
        appendLedgerEntry(storeDir, { ...entry, error: fit.error });
        process.stdout.write(
          opts.json
            ? `${JSON.stringify({ run: { id: runId, dir, cached: false }, fit }, null, 2)}\n`
            : `${formatFitResult(fit, config.channel, join(dir, "run.json"))}\n`,
        );
        process.exitCode = 1;
        return;
      }

      writeFileSync(join(dir, basename(config.modelPath)), modelSource);
      const frozen = {
        ...config.spec,
        backend: { ...config.spec.backend, version: config.channel },
        model: { ...config.spec.model, path: `./${basename(config.modelPath)}` },
      };
      writeFileSync(join(dir, "spec.toml"), serializeSpecToml(frozen));

      const samples = parseSamples(readFileSync(join(dir, "samples.json"), "utf8"));
      const report = buildDiagnosticsReport(samples);
      appendLedgerEntry(storeDir, { ...entry, diagnostics: diagnosticsSummary(report) });

      say(
        `${pc.green("ok:")} run ${runId} (${(fit.elapsedMs / 1000).toFixed(1)} s, Julia ${fit.runtimeActual ?? config.channel}) saved to ${displayPath(storeDir)}`,
      );
      say("");
      finish(report, runId, false, fit);
    });
}
