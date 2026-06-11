import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  canonicalJson,
  parseSamples,
  type ResolvedSpec,
  RUN_RECORD_SCHEMA_VERSION,
  type RunRecord,
} from "@mcmcjs/core";
import type { FitProgress, FitResult, FitRunner } from "@mcmcjs/engine";
import { driverPath, lastJsonLine, sha256, toStage } from "./runner-common";

export interface FitIo {
  /** Spawns the Julia process; injectable so runFit is testable without Julia. */
  spawn: FitRunner;
  /** The managed Julia project directory passed as --project. */
  projectDir: string;
  /** Where the samples file is written. */
  outPath: string;
  /** Where the run record is written; defaults to `<outPath>.run.json`. */
  recordPath?: string;
  /** Streamed per-chain sampling progress. */
  onProgress?: (progress: FitProgress) => void;
  tmpDir?: string;
}

/** A fresh request dir under the shared tmpdir()/mcmcjs parent. */
function makeRequestDir(): string {
  const parent = join(tmpdir(), "mcmcjs");
  mkdirSync(parent, { recursive: true });
  return mkdtempSync(join(parent, "fit-"));
}

/** Runs one inference for a resolved spec on a resolved runtime invocation. */
export async function runFit(
  spec: ResolvedSpec,
  resolved: { command: string; args: string[] },
  io: FitIo,
): Promise<FitResult> {
  const startedAt = new Date().toISOString();
  const start = performance.now();
  const runtimeRequested = spec.backend.version;

  const ownTmp = io.tmpDir === undefined;
  const tmp = io.tmpDir ?? makeRequestDir();
  const requestPath = join(tmp, "request.json");
  writeFileSync(
    requestPath,
    JSON.stringify({
      schema_version: spec.schema_version,
      backend: { id: spec.backend.id },
      model: { file: spec.modelPath, entry: spec.model.entry },
      data: spec.data,
      sampler: spec.sampler,
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
  let stdout: string;
  let stderr: string;
  let code: number;
  try {
    ({ stdout, stderr, code } = await io.spawn(resolved.command, args, {
      onProgress: io.onProgress,
    }));
  } finally {
    if (ownTmp) rmSync(tmp, { recursive: true, force: true });
  }
  const elapsedMs = Math.round(performance.now() - start);

  if (code !== 0 || !existsSync(io.outPath)) {
    const failure = lastJsonLine(stderr);
    const stage = toStage(failure?.stage);
    const error =
      (failure?.error as string) ??
      stderr.trim().split("\n").pop() ??
      `julia exited with code ${code}`;
    return { status: "error", runtimeRequested, elapsedMs, stage, error };
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
    data_sha256: sha256(canonicalJson(spec.data)),
    samples_file: io.outPath,
    started_at: startedAt,
    elapsed_ms: elapsedMs,
  };
  writeFileSync(io.recordPath ?? `${io.outPath}.run.json`, `${JSON.stringify(record, null, 2)}\n`);

  return {
    status: "ok",
    samplesFile: io.outPath,
    runtimeRequested,
    runtimeActual: julia,
    elapsedMs,
  };
}
