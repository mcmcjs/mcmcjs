import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  canonicalJson,
  parseSamples,
  type ResolvedSpec,
  RUN_RECORD_SCHEMA_VERSION,
  type RunRecord,
} from "@mcmcjs/core";
import type { DrawBatch, FitProgress, FitResult, FitRunner } from "@mcmcjs/engine";
import { driverPath, lastJsonLine, sha256, sharedTmpParent, toStage } from "./runner-common";

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
  /** Streamed draw batches as sampling proceeds. */
  onDraws?: (batch: DrawBatch) => void;
  /** Raw console lines from the sampler as they arrive (structured progress/draws
   * lines are filtered out), for surfacing solver logs live. */
  onLog?: (line: string, stream: "stdout" | "stderr") => void;
  /** Draws per streamed batch (driver default 25); lower it when models have many leaves. */
  drawBatchSize?: number;
  /** Write a checkpoint for each chain at every streamed draw-batch boundary. */
  checkpointDir?: string;
  /** Digest of the immutable model source bundle and runtime image. */
  checkpointScopeSha256?: string;
  /** Resume one NUTS chain from a checkpoint written by this runtime. */
  resumeFrom?: string;
  /** Expected SHA-256 of the checkpoint bytes, checked before deserialization. */
  resumeSha256?: string;
  /** Aborts an in-progress fit; the run then ends with a "cancelled" status. */
  signal?: AbortSignal;
  /** Source path when the data came from a referenced file; recorded, not copied. */
  dataFile?: string;
  /** Overrides the recorded data hash (e.g. the data file's bytes hash). */
  dataSha256?: string;
  tmpDir?: string;
}

/** A fresh request dir under the shared per-user tmp parent. */
export function makeRequestDir(kind: string): string {
  const parent = sharedTmpParent();
  mkdirSync(parent, { recursive: true });
  return mkdtempSync(join(parent, `${kind}-`));
}

/** The driver/worker request object for one fit. */
export function fitRequest(
  spec: ResolvedSpec,
  outPath: string,
  opts?: {
    streamDraws?: boolean;
    drawBatchSize?: number;
    checkpointDir?: string;
    checkpointScopeSha256?: string;
    resumeFrom?: string;
    resumeSha256?: string;
  },
): Record<string, unknown> {
  return {
    schema_version: spec.schema_version,
    backend: { id: spec.backend.id },
    model: {
      file: spec.modelPath,
      entry: spec.model.entry,
      ...(spec.model.evaluation_mode ? { evaluation_mode: spec.model.evaluation_mode } : {}),
      ...(spec.model.monitor ? { monitor: spec.model.monitor } : {}),
    },
    data: spec.data,
    sampler: spec.sampler,
    seed: spec.seed,
    out: outPath,
    ...(opts?.streamDraws ? { stream_draws: true } : {}),
    ...(opts?.drawBatchSize ? { draw_batch_size: opts.drawBatchSize } : {}),
    ...(opts?.checkpointDir ? { checkpoint_dir: opts.checkpointDir } : {}),
    ...(opts?.checkpointScopeSha256 ? { checkpoint_scope_sha256: opts.checkpointScopeSha256 } : {}),
    ...(opts?.resumeFrom ? { resume_from: opts.resumeFrom } : {}),
    ...(opts?.resumeSha256 ? { resume_sha256: opts.resumeSha256 } : {}),
    ...(opts?.checkpointDir || opts?.resumeFrom
      ? { data_sha256: sha256(canonicalJson(spec.data)) }
      : {}),
  };
}

/**
 * Validates the written samples and records provenance; the success tail
 * shared by the one-shot driver and the worker paths.
 */
export function finalizeOkFit(
  spec: ResolvedSpec,
  resolved: { command: string },
  io: Pick<FitIo, "outPath" | "recordPath" | "dataFile" | "dataSha256">,
  provenance: Record<string, unknown> | undefined,
  startedAt: string,
  elapsedMs: number,
): FitResult {
  const runtimeRequested = spec.backend.version;
  if (!existsSync(io.outPath)) {
    return {
      status: "error",
      runtimeRequested,
      elapsedMs,
      stage: "write",
      error: "the runtime reported success but wrote no samples file",
    };
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
    data_sha256: io.dataSha256 ?? sha256(canonicalJson(spec.data)),
    ...(io.dataFile ? { data_file: io.dataFile } : {}),
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

/** Runs one inference for a resolved spec on a resolved runtime invocation. */
export async function runFit(
  spec: ResolvedSpec,
  resolved: { command: string; args: string[] },
  io: FitIo,
): Promise<FitResult> {
  const startedAt = new Date().toISOString();
  const start = performance.now();
  const runtimeRequested = spec.backend.version;

  if (io.signal?.aborted) {
    return { status: "cancelled", runtimeRequested, elapsedMs: 0 };
  }
  if (io.resumeFrom && !io.resumeSha256) {
    throw new Error("resumeSha256 is required when resuming a checkpoint");
  }
  if (
    (io.checkpointDir || io.resumeFrom) &&
    !/^[0-9a-f]{64}$/.test(io.checkpointScopeSha256 ?? "")
  ) {
    throw new Error("checkpointScopeSha256 is required for checkpoints");
  }

  const ownTmp = io.tmpDir === undefined;
  const tmp = io.tmpDir ?? makeRequestDir("fit");
  const requestPath = join(tmp, "request.json");
  writeFileSync(
    requestPath,
    JSON.stringify(
      fitRequest(spec, io.outPath, {
        streamDraws: io.onDraws !== undefined || io.checkpointDir !== undefined,
        drawBatchSize: io.drawBatchSize,
        checkpointDir: io.checkpointDir,
        checkpointScopeSha256: io.checkpointScopeSha256,
        resumeFrom: io.resumeFrom,
        resumeSha256: io.resumeSha256,
      }),
    ),
  );

  const args = [
    ...resolved.args,
    "--startup-file=no",
    ...(spec.sampler.parallel === "threads" ? ["--threads=auto"] : []),
    `--project=${io.projectDir}`,
    driverPath(),
    requestPath,
  ];
  let stdout: string;
  let stderr: string;
  let code: number;
  let cancelled: boolean | undefined;
  try {
    ({ stdout, stderr, code, cancelled } = await io.spawn(resolved.command, args, {
      onProgress: io.onProgress,
      onDraws: io.onDraws,
      onLog: io.onLog,
      signal: io.signal,
    }));
  } finally {
    if (ownTmp) rmSync(tmp, { recursive: true, force: true });
  }
  const elapsedMs = Math.round(performance.now() - start);

  if (cancelled) {
    return { status: "cancelled", runtimeRequested, elapsedMs };
  }

  if (code !== 0 || !existsSync(io.outPath)) {
    const failure = lastJsonLine(stderr);
    const stage = toStage(failure?.stage);
    const error =
      (failure?.error as string) ??
      stderr.trim().split("\n").pop() ??
      `julia exited with code ${code}`;
    return { status: "error", runtimeRequested, elapsedMs, stage, error };
  }

  return finalizeOkFit(spec, resolved, io, lastJsonLine(stdout), startedAt, elapsedMs);
}
