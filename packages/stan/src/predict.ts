import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  canonicalJson,
  fromStanCSVFiles,
  parseSamples,
  type ResolvedSpec,
  RUN_RECORD_SCHEMA_VERSION,
  type RunRecord,
  type Samples,
  toMCMCChainsJson,
  toStanName,
} from "@mcmcjs/core";
import type { FitResult } from "@mcmcjs/engine";
import { type CompileOptions, compileModel } from "./compile";
import type { CmdStanInstall } from "./environment";
import { createStanSpawn, type StanSpawn } from "./runner";

export interface StanPredictIo {
  /** Where the posterior-predictive samples file is written. */
  outPath: string;
  /** The posterior samples file fed to prediction. */
  samplesPath: string;
  /** Spawns CmdStan processes; injectable so runPredict is testable without CmdStan. */
  spawn?: StanSpawn;
  /** Model compile pass-through, injectable for tests. */
  compile?: CompileOptions;
  signal?: AbortSignal;
  tmpDir?: string;
}

/**
 * The prediction data: [data] with [predict].data overrides. Unlike the Julia
 * engines, targets are not blanked; Stan predictions come from the model's own
 * generated quantities block, which reads the data as-is.
 */
export function predictData(spec: ResolvedSpec): Record<string, unknown> {
  if (!spec.predict) throw new Error("spec has no [predict] block");
  return { ...spec.data, ...(spec.predict.data ?? {}) };
}

/**
 * One Stan-CSV of fitted parameters per chain, rebuilt from the samples file.
 * CmdStan's generate_quantities reads parameters by header name and ignores
 * extra columns, so a header plus the parameter draws is sufficient.
 */
export function fittedParamsCsv(samples: Samples, chain: number): string {
  const names = samples.variables;
  const header = names.map(toStanName).join(",");
  const columns = names.map((name) => samples.draws.get(name) as Float64Array);
  const start = chain * samples.nDraws;
  const rows: string[] = [header];
  for (let i = 0; i < samples.nDraws; i++) {
    rows.push(columns.map((col) => stanCell(col[start + i] ?? Number.NaN)).join(","));
  }
  return `${rows.join("\n")}\n`;
}

function stanCell(value: number): string {
  if (Number.isFinite(value)) return String(value);
  if (Number.isNaN(value)) return "nan";
  return value > 0 ? "inf" : "-inf";
}

/** Whether a scalarized variable name belongs to a predict target base name. */
export function matchesTarget(name: string, targets: readonly string[]): boolean {
  return targets.some((t) => name === t || name.startsWith(`${t}[`));
}

function filterToTargets(all: Samples, targets: readonly string[]): Samples {
  const draws = new Map<string, Float64Array>();
  for (const name of all.variables) {
    if (matchesTarget(name, targets)) {
      draws.set(name, all.draws.get(name) as Float64Array);
    }
  }
  return {
    variables: [...draws.keys()],
    nChains: all.nChains,
    nDraws: all.nDraws,
    draws,
    sampleStats: new Map(),
  };
}

function baseNames(variables: readonly string[]): string[] {
  return [...new Set(variables.map((v) => v.replace(/\[.*$/, "")))];
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function tmpParent(): string {
  const uid = typeof process.getuid === "function" ? `-${process.getuid()}` : "";
  return join(tmpdir(), `mcmcjs${uid}`);
}

/**
 * Draws posterior-predictive samples through CmdStan's generate_quantities:
 * the model's generated quantities block re-runs once per posterior draw, and
 * the columns matching [predict].targets become the predictive samples file.
 */
export async function runPredict(
  spec: ResolvedSpec,
  install: CmdStanInstall,
  io: StanPredictIo,
): Promise<FitResult> {
  const startedAt = new Date().toISOString();
  const start = performance.now();
  const runtimeRequested = spec.backend.version;
  const elapsed = () => Math.round(performance.now() - start);
  const fail = (stage: FitResult["stage"], error: string): FitResult => ({
    status: "error",
    runtimeRequested,
    elapsedMs: elapsed(),
    stage,
    error,
  });

  const targets = spec.predict?.targets;
  if (!targets || targets.length === 0) {
    return fail("predict", "spec has no [predict] block");
  }
  if (io.signal?.aborted) {
    return { status: "cancelled", runtimeRequested, elapsedMs: 0 };
  }

  let posterior: Samples;
  try {
    posterior = parseSamples(readFileSync(io.samplesPath, "utf8"));
  } catch (error) {
    return fail("load_samples", `posterior samples did not parse: ${(error as Error).message}`);
  }

  let binaryPath: string;
  try {
    ({ binaryPath } = await compileModel(install, spec.modelPath, io.compile));
  } catch (error) {
    return fail("compile", (error as Error).message);
  }

  const ownTmp = io.tmpDir === undefined;
  let tmp: string;
  if (io.tmpDir === undefined) {
    mkdirSync(tmpParent(), { recursive: true });
    tmp = mkdtempSync(join(tmpParent(), "stan-predict-"));
  } else {
    tmp = io.tmpDir;
  }

  try {
    const data = predictData(spec);
    const dataPath = join(tmp, "data.json");
    writeFileSync(dataPath, JSON.stringify(data));

    const spawn = io.spawn ?? createStanSpawn();
    const chains = posterior.nChains;
    // CmdStan rejects a fitted_params name that is a substring of the output
    // name, so the two use unrelated stems.
    const results = await Promise.all(
      Array.from({ length: chains }, (_, i) => {
        const fittedPath = join(tmp, `fitted_${i + 1}.csv`);
        writeFileSync(fittedPath, fittedParamsCsv(posterior, i));
        return spawn(
          binaryPath,
          [
            "generate_quantities",
            `fitted_params=${fittedPath}`,
            "data",
            `file=${dataPath}`,
            "random",
            `seed=${spec.seed}`,
            `id=${i + 1}`,
            "output",
            `file=${join(tmp, `gq_${i + 1}.csv`)}`,
          ],
          { signal: io.signal },
        );
      }),
    );

    if (io.signal?.aborted || results.some((r) => r.cancelled)) {
      return { status: "cancelled", runtimeRequested, elapsedMs: elapsed() };
    }
    const failed = results.findIndex((r) => r.code !== 0);
    if (failed >= 0) {
      const stderr = results[failed]?.stderr ?? "";
      if (/doesn't generate any quantities/i.test(stderr)) {
        return fail(
          "predict",
          `the Stan model has no generated quantities block; add one that computes ${targets.join(", ")}`,
        );
      }
      const tail = stderr.trim().split("\n").filter(Boolean).at(-1);
      return fail(
        "predict",
        `generate_quantities failed for chain ${failed + 1}${tail ? `: ${tail}` : ""}`,
      );
    }

    let predictive: Samples;
    try {
      const texts = Array.from({ length: chains }, (_, i) =>
        readFileSync(join(tmp, `gq_${i + 1}.csv`), "utf8"),
      );
      predictive = filterToTargets(fromStanCSVFiles(texts), targets);
    } catch (error) {
      return fail(
        "load_samples",
        `could not read generate_quantities output: ${(error as Error).message}`,
      );
    }
    if (predictive.variables.length === 0) {
      const available = baseNames(fromStanCSVFilesNames(tmp, chains));
      return fail(
        "predict",
        `no generated quantity matches targets ${targets.join(", ")}; the model generates: ${
          available.length > 0 ? available.join(", ") : "(nothing)"
        }`,
      );
    }

    try {
      const json = JSON.stringify(toMCMCChainsJson(predictive));
      parseSamples(json);
      const partial = `${io.outPath}.tmp`;
      writeFileSync(partial, json);
      renameSync(partial, io.outPath);
    } catch (error) {
      return fail("write", (error as Error).message);
    }

    const record: RunRecord = {
      schema_version: RUN_RECORD_SCHEMA_VERSION,
      spec_hash: spec.specHash,
      seed: spec.seed,
      backend: { id: spec.backend.id, runtime: spec.backend.runtime },
      runtime: { requested: runtimeRequested, actual: install.version, path: install.home },
      model_sha256: existsSync(spec.modelPath)
        ? sha256(readFileSync(spec.modelPath, "utf8"))
        : undefined,
      data_sha256: sha256(canonicalJson(data)),
      posterior_samples: io.samplesPath,
      posterior_samples_sha256: sha256(readFileSync(io.samplesPath, "utf8")),
      samples_file: io.outPath,
      started_at: startedAt,
      elapsed_ms: elapsed(),
    };
    try {
      writeFileSync(`${io.outPath}.run.json`, `${JSON.stringify(record, null, 2)}\n`);
    } catch (error) {
      return fail("write", `could not write the run record: ${(error as Error).message}`);
    }

    return {
      status: "ok",
      samplesFile: io.outPath,
      runtimeRequested,
      runtimeActual: install.version,
      elapsedMs: elapsed(),
    };
  } finally {
    if (ownTmp) rmSync(tmp, { recursive: true, force: true });
  }
}

function fromStanCSVFilesNames(tmp: string, chains: number): string[] {
  try {
    const texts = Array.from({ length: chains }, (_, i) =>
      readFileSync(join(tmp, `gq_${i + 1}.csv`), "utf8"),
    );
    return [...fromStanCSVFiles(texts).variables];
  } catch {
    return [];
  }
}
