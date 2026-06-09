import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  canonicalJson,
  parseSamples,
  type ResolvedSpec,
  RUN_RECORD_SCHEMA_VERSION,
  type RunRecord,
} from "@mcmcjs/core";
import type { FitResult, FitRunner } from "@mcmcjs/engine";
import { driverPath, lastJsonLine, sha256, toStage } from "./runner-common";

export interface PredictIo {
  /** Spawns the Julia process; injectable so runPredict is testable without Julia. */
  spawn: FitRunner;
  projectDir: string;
  /** Where the posterior-predictive samples file is written. */
  outPath: string;
  /** The posterior samples file fed to prediction. */
  samplesPath: string;
  tmpDir?: string;
}

/** The prediction data: [data] with [predict].data overrides, target outcomes blanked to nulls. */
export function predictData(spec: ResolvedSpec): Record<string, unknown> {
  const predict = spec.predict;
  if (!predict) throw new Error("spec has no [predict] block");
  const data: Record<string, unknown> = { ...spec.data, ...(predict.data ?? {}) };
  // Blank a target to null, preserving array shape so the driver maps it to a
  // matching shape of `missing` (a multidimensional outcome stays nested).
  const blank = (value: unknown): unknown => (Array.isArray(value) ? value.map(blank) : null);
  for (const target of predict.targets) {
    data[target] = blank(data[target]);
  }
  return data;
}

/** Draws posterior-predictive samples from a fitted model and its posterior samples file. */
export async function runPredict(
  spec: ResolvedSpec,
  resolved: { command: string; args: string[] },
  io: PredictIo,
): Promise<FitResult> {
  const startedAt = new Date().toISOString();
  const start = performance.now();
  const runtimeRequested = spec.backend.version;
  const data = predictData(spec);

  const tmp = io.tmpDir ?? mkdtempSync(join(tmpdir(), "mcmcjs-predict-"));
  const requestPath = join(tmp, "request.json");
  writeFileSync(
    requestPath,
    JSON.stringify({
      mode: "predict",
      schema_version: spec.schema_version,
      backend: { id: spec.backend.id },
      model: { file: spec.modelPath, entry: spec.model.entry },
      data,
      predict: { targets: spec.predict?.targets ?? [] },
      samples: io.samplesPath,
      seed: spec.seed,
      out: io.outPath,
    }),
  );

  const args = [
    ...resolved.args,
    "--startup-file=no",
    `--project=${io.projectDir}`,
    driverPath(),
    requestPath,
  ];
  const { stdout, stderr, code } = await io.spawn(resolved.command, args);
  const elapsedMs = Math.round(performance.now() - start);

  if (code !== 0 || !existsSync(io.outPath)) {
    const failure = lastJsonLine(stderr);
    const error =
      (failure?.error as string) ??
      stderr.trim().split("\n").pop() ??
      `julia exited with code ${code}`;
    return { status: "error", runtimeRequested, elapsedMs, stage: toStage(failure?.stage), error };
  }

  try {
    parseSamples(readFileSync(io.outPath, "utf8"));
  } catch (error) {
    return {
      status: "error",
      runtimeRequested,
      elapsedMs,
      stage: "write",
      error: `samples file did not parse: ${(error as Error).message}`,
    };
  }

  const provenance = lastJsonLine(stdout);
  const julia = provenance?.julia_version as string | undefined;
  const record: RunRecord = {
    schema_version: RUN_RECORD_SCHEMA_VERSION,
    spec_hash: spec.specHash,
    seed: spec.seed,
    backend: { id: spec.backend.id, runtime: spec.backend.runtime },
    runtime: { requested: runtimeRequested, actual: julia, path: resolved.command },
    manifest_sha256: provenance?.manifest_sha256 as string | undefined,
    packages: provenance?.packages as Record<string, string> | undefined,
    model_sha256: existsSync(spec.modelPath)
      ? sha256(readFileSync(spec.modelPath, "utf8"))
      : undefined,
    data_sha256: sha256(canonicalJson(data)),
    posterior_samples: io.samplesPath,
    posterior_samples_sha256: existsSync(io.samplesPath)
      ? sha256(readFileSync(io.samplesPath, "utf8"))
      : undefined,
    samples_file: io.outPath,
    started_at: startedAt,
    elapsed_ms: elapsedMs,
  };
  writeFileSync(`${io.outPath}.run.json`, `${JSON.stringify(record, null, 2)}\n`);

  return {
    status: "ok",
    samplesFile: io.outPath,
    runtimeRequested,
    runtimeActual: julia,
    elapsedMs,
  };
}
