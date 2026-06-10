import { randomInt } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import { parseSamples, parseSpec, SpecSchema, serializeSpecToml } from "@mcmcjs/core";
import { createFitRunner, createRunner, type EngineContext } from "@mcmcjs/engine";
import { ensureProject, managedProjectReady, resolveVersion, runFit } from "@mcmcjs/julia";
import type { Command } from "commander";
import { ZodError } from "zod";
import { convertGraph } from "./convert";
import { loadDataFile } from "./data-file";
import { buildDiagnosticsReport, formatReportHuman } from "./diagnose";
import { defaultOut, formatFitResult } from "./fit";
import { juliaupBin } from "./julia";

const INSTALL_TIMEOUT_MS = 30 * 60_000;
const MAX_SEED = 2_147_483_647;

/** Guess the PPL from the model source; undefined when neither marker is found. */
export function detectBackend(source: string): "turing" | "juliabugs" | undefined {
  if (/\bJuliaBUGS\b/.test(source)) return "juliabugs";
  if (/@model\b|\busing Turing\b/.test(source)) return "turing";
  return undefined;
}

export interface ScaffoldOptions {
  modelFileName: string;
  backend: "turing" | "juliabugs";
  data: Record<string, unknown>;
  seed: number;
  draws: number;
  warmup: number;
  chains: number;
  entry?: string;
}

/** Build a default spec object for a model file (the `mcmc run` scaffold). */
export function scaffoldSpec(opts: ScaffoldOptions): Record<string, unknown> {
  return {
    schema_version: "0",
    seed: opts.seed,
    backend: { id: opts.backend },
    model: {
      kind: "file",
      path: `./${opts.modelFileName}`,
      ...(opts.entry ? { entry: opts.entry } : {}),
    },
    sampler: { algorithm: "NUTS", draws: opts.draws, warmup: opts.warmup, chains: opts.chains },
    data: opts.data,
  };
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

interface RunCliOptions {
  data?: string;
  out?: string;
  draws?: number;
  warmup?: number;
  chains?: number;
  seed?: number;
  backend?: string;
  entry?: string;
  init?: boolean;
  juliaVersion?: string;
  json?: boolean;
}

function parseIntOption(value: string): number {
  const n = Number.parseInt(value, 10);
  if (!Number.isInteger(n)) throw new Error(`expected an integer, got "${value}"`);
  return n;
}

const SCAFFOLD_FLAGS = ["data", "seed", "backend", "entry", "draws", "warmup", "chains"] as const;

function rejectScaffoldFlags(opts: RunCliOptions, why: string): void {
  const given = SCAFFOLD_FLAGS.filter((f) => opts[f] !== undefined);
  if (given.length > 0) {
    throw new Error(`${why}; --${given[0]} only applies when scaffolding a new spec.`);
  }
}

function validateScaffold(spec: Record<string, unknown>): void {
  try {
    SpecSchema.parse(spec);
  } catch (error) {
    if (error instanceof ZodError) {
      const detail = error.issues
        .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
        .join("; ");
      throw new Error(`cannot scaffold a valid spec: ${detail}`);
    }
    throw error;
  }
}

// Resolve the input to a spec path, scaffolding or converting when needed.
// Returns the spec path plus any human-readable notes to print.
export function resolveToSpec(
  inputPath: string,
  opts: RunCliOptions,
): { specPath: string; notes: string[] } {
  const kind = classifyInput(inputPath);
  const notes: string[] = [];

  if (kind === "spec") {
    rejectScaffoldFlags(opts, `${inputPath} is already a spec; edit it to configure the run`);
    return { specPath: inputPath, notes };
  }

  if (kind === "graph") {
    const specPath = `${inputPath.replace(/\.json$/i, "")}.toml`;
    if (existsSync(specPath)) {
      rejectScaffoldFlags(
        opts,
        `${specPath} already exists; edit it or delete it to regenerate from the graph`,
      );
      notes.push(`using existing spec ${specPath}`);
      return { specPath, notes };
    }
    for (const flag of ["data", "backend", "entry"] as const) {
      if (opts[flag] !== undefined) {
        throw new Error(`--${flag} does not apply to a graph; it carries its own data and model`);
      }
    }
    const result = convertGraph(inputPath, undefined, opts.seed ?? randomInt(0, MAX_SEED), {
      draws: opts.draws ?? 1000,
      warmup: opts.warmup ?? 1000,
      chains: opts.chains ?? 4,
    });
    notes.push(`converted ${basename(inputPath)} -> ${result.modelPath}`);
    notes.push(`wrote ${result.specPath}`);
    notes.push(`edit ${basename(result.specPath)} to configure the run; it is reused next time`);
    return { specPath: result.specPath, notes };
  }

  // A model file: reuse its sibling spec if present, otherwise scaffold one.
  const specPath = join(dirname(inputPath), `${basename(inputPath, extname(inputPath))}.toml`);
  if (existsSync(specPath)) {
    rejectScaffoldFlags(opts, `${specPath} already exists; edit it or delete it to regenerate`);
    notes.push(`using existing spec ${specPath}`);
    return { specPath, notes };
  }

  const source = readFileSync(inputPath, "utf8");
  const detected = opts.backend === undefined;
  const backend = (opts.backend as "turing" | "juliabugs" | undefined) ?? detectBackend(source);
  if (!backend) {
    throw new Error(
      `could not detect the backend from ${inputPath}; pass --backend turing|juliabugs`,
    );
  }
  if (backend !== "turing" && backend !== "juliabugs") {
    throw new Error(`unknown backend "${backend}" (expected turing or juliabugs)`);
  }

  const spec = scaffoldSpec({
    modelFileName: basename(inputPath),
    backend,
    data: opts.data ? loadDataFile(opts.data) : {},
    seed: opts.seed ?? randomInt(0, MAX_SEED),
    draws: opts.draws ?? 1000,
    warmup: opts.warmup ?? 1000,
    chains: opts.chains ?? 4,
    entry: opts.entry,
  });
  validateScaffold(spec);
  const toml = serializeSpecToml(spec);
  writeFileSync(specPath, toml);
  notes.push(
    `wrote ${specPath} (backend ${backend}${detected ? ", detected from the model file" : ""})`,
  );
  notes.push("");
  notes.push(toml.trimEnd());
  notes.push("");
  notes.push(`edit ${basename(specPath)} to configure the run; it is reused next time`);
  return { specPath, notes };
}

export function registerRun(program: Command, ctx: EngineContext): void {
  program
    .command("run")
    .argument("<input>", "model file (.jl), spec file (.toml/.json), or DoodleBUGS graph (.json)")
    .description("Run the whole workflow: scaffold a spec if needed, then fit and diagnose")
    .option("--data <file>", "data file for a new spec (.json object or .csv columns)")
    .option("-o, --out <file>", "samples output path")
    .option("--draws <n>", "posterior draws for a new spec (default 1000)", parseIntOption)
    .option("--warmup <n>", "warmup iterations for a new spec (default 1000)", parseIntOption)
    .option("--chains <n>", "number of chains for a new spec (default 4)", parseIntOption)
    .option("--seed <n>", "seed for a new spec (default: drawn once and saved)", parseIntOption)
    .option("--backend <id>", "backend for a new spec (default: detected from the model)")
    .option("--entry <name>", "model entry function for a new spec")
    .option("--init", "only write and show the spec; skip fit and diagnose")
    .option("--julia-version <channel>", "Julia version/channel to run (overrides the spec)")
    .option("--json", "print results as JSON")
    .addHelpText(
      "after",
      "\nExit codes: 0 = converged, 1 = error, 2 = ran but not converged.\nA model file gets a sibling spec (model.jl -> model.toml), created on first run.",
    )
    .action(async (input: string, opts: RunCliOptions) => {
      const inputPath = resolve(input);
      const { specPath, notes } = resolveToSpec(inputPath, opts);
      if (!opts.json) {
        for (const note of notes) process.stdout.write(`${note}\n`);
      }
      if (opts.init) {
        if (opts.json) {
          process.stdout.write(`${JSON.stringify({ ok: true, spec: specPath }, null, 2)}\n`);
        }
        return;
      }

      const spec = parseSpec(specPath);
      const channel = opts.juliaVersion ?? spec.backend.version;
      const outPath = resolve(opts.out ?? defaultOut(specPath));
      const bin = await juliaupBin(ctx);
      const resolved = await resolveVersion(bin, channel, ctx.run);

      if (!opts.json && !managedProjectReady()) {
        process.stdout.write(
          "Preparing the Julia environment (first run can take a few minutes)...\n",
        );
      }
      const projectDir = await ensureProject(resolved.command, createRunner(INSTALL_TIMEOUT_MS));

      if (!opts.json) {
        process.stdout.write(`Fitting ${spec.backend.id} on Julia ${channel}...\n`);
      }
      const fit = await runFit(spec, resolved, {
        spawn: createFitRunner(),
        projectDir,
        outPath,
      });
      if (fit.status !== "ok") {
        process.stdout.write(
          opts.json
            ? `${JSON.stringify({ spec: specPath, fit }, null, 2)}\n`
            : `${formatFitResult(fit, channel, `${outPath}.run.json`)}\n`,
        );
        process.exitCode = 1;
        return;
      }

      const samples = parseSamples(readFileSync(outPath, "utf8"));
      const report = buildDiagnosticsReport(samples);

      if (opts.json) {
        process.stdout.write(`${JSON.stringify({ spec: specPath, fit, report }, null, 2)}\n`);
      } else {
        process.stdout.write(`${formatFitResult(fit, channel, `${outPath}.run.json`)}\n\n`);
        process.stdout.write(formatReportHuman(report));
      }
      process.exitCode = report.converged ? 0 : 2;
    });
}
