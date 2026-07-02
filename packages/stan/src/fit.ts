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
  toMCMCChainsJson,
} from "@mcmcjs/core";
import type { DrawBatch, FitProgress, FitResult } from "@mcmcjs/engine";
import { type CompileOptions, compileModel } from "./compile";
import { createStanCsvTail } from "./csv";
import type { CmdStanInstall } from "./environment";
import { createStanSpawn, parseIterationLine, type StanSpawn } from "./runner";

export interface StanFitIo {
  /** Spawns CmdStan processes; injectable so runFit is testable without CmdStan. */
  spawn?: StanSpawn;
  /** Where the samples file is written. */
  outPath: string;
  /** Where the run record is written; defaults to `<outPath>.run.json`. */
  recordPath?: string;
  /** Streamed per-chain sampling progress. */
  onProgress?: (progress: FitProgress) => void;
  /** Streamed draw batches as sampling proceeds. */
  onDraws?: (batch: DrawBatch) => void;
  /** Draws per streamed batch (default 25). */
  drawBatchSize?: number;
  /** Aborts an in-progress fit; the run then ends with a "cancelled" status. */
  signal?: AbortSignal;
  /** Source path when the data came from a referenced file; recorded, not copied. */
  dataFile?: string;
  /** Overrides the recorded data hash (e.g. the data file's bytes hash). */
  dataSha256?: string;
  /** Model compile pass-through, injectable for tests. */
  compile?: CompileOptions;
  tmpDir?: string;
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function tmpParent(): string {
  const uid = typeof process.getuid === "function" ? `-${process.getuid()}` : "";
  return join(tmpdir(), `mcmcjs${uid}`);
}

/** The per-chain CmdStan invocation. Chains share one seed; `id` varies the stream. */
export function chainArgs(
  spec: ResolvedSpec,
  chain1: number,
  dataPath: string,
  csvPath: string,
): string[] {
  const s = spec.sampler;
  const total = s.draws + s.warmup;
  // Progress at roughly 1% granularity without flooding stdout on long runs.
  const refresh = Math.max(1, Math.floor(total / 100));
  return [
    "sample",
    `num_samples=${s.draws}`,
    `num_warmup=${s.warmup}`,
    "adapt",
    `delta=${s.adapt_delta}`,
    "data",
    `file=${dataPath}`,
    "random",
    `seed=${spec.seed}`,
    `id=${chain1}`,
    "output",
    `file=${csvPath}`,
    `refresh=${refresh}`,
  ];
}

function errorTail(stderr: string): string | undefined {
  const lines = stderr
    .trim()
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  return lines.at(-1);
}

/** Runs one Stan inference on a resolved CmdStan install. */
export async function runFit(
  spec: ResolvedSpec,
  install: CmdStanInstall,
  io: StanFitIo,
): Promise<FitResult> {
  const startedAt = new Date().toISOString();
  const start = performance.now();
  const runtimeRequested = spec.backend.version;
  const fail = (stage: FitResult["stage"], error: string): FitResult => ({
    status: "error",
    runtimeRequested,
    elapsedMs: Math.round(performance.now() - start),
    stage,
    error,
  });

  if (io.signal?.aborted) {
    return { status: "cancelled", runtimeRequested, elapsedMs: 0 };
  }

  let binaryPath: string;
  try {
    ({ binaryPath } = await compileModel(install, spec.modelPath, io.compile));
  } catch (error) {
    return fail("compile", (error as Error).message);
  }
  if (io.signal?.aborted) {
    return {
      status: "cancelled",
      runtimeRequested,
      elapsedMs: Math.round(performance.now() - start),
    };
  }

  const ownTmp = io.tmpDir === undefined;
  let tmp: string;
  if (io.tmpDir === undefined) {
    mkdirSync(tmpParent(), { recursive: true });
    tmp = mkdtempSync(join(tmpParent(), "stan-fit-"));
  } else {
    tmp = io.tmpDir;
  }

  try {
    const dataPath = join(tmp, "data.json");
    writeFileSync(dataPath, JSON.stringify(spec.data));

    const chains = spec.sampler.chains;
    const spawn = io.spawn ?? createStanSpawn();
    const csvPaths = Array.from({ length: chains }, (_, i) => join(tmp, `chain_${i + 1}.csv`));

    const tails = io.onDraws
      ? csvPaths.map((path, i) =>
          createStanCsvTail(path, {
            chain: i,
            batchSize: io.drawBatchSize ?? 25,
            onBatch: io.onDraws as (batch: DrawBatch) => void,
          }),
        )
      : [];
    const pollTimer =
      tails.length > 0
        ? setInterval(() => {
            for (const tail of tails) tail.poll();
          }, 150)
        : undefined;
    pollTimer?.unref?.();

    let results: { code: number; stderr: string; cancelled?: boolean }[];
    try {
      results = await Promise.all(
        csvPaths.map((csvPath, i) => {
          const onProgress = io.onProgress;
          return spawn(binaryPath, chainArgs(spec, i + 1, dataPath, csvPath), {
            signal: io.signal,
            onStdoutLine: onProgress
              ? (line) => {
                  const p = parseIterationLine(line);
                  if (!p) return;
                  onProgress({
                    chain: i + 1,
                    of: chains,
                    fraction: p.total > 0 ? p.iteration / p.total : 0,
                    done: p.iteration === p.total,
                  });
                }
              : undefined,
          });
        }),
      );
    } finally {
      if (pollTimer) clearInterval(pollTimer);
    }
    for (const tail of tails) tail.finish();

    const elapsedMs = Math.round(performance.now() - start);
    if (io.signal?.aborted || results.some((r) => r.cancelled)) {
      return { status: "cancelled", runtimeRequested, elapsedMs };
    }
    const failed = results.findIndex((r) => r.code !== 0);
    if (failed >= 0) {
      const r = results[failed];
      return fail(
        "sample",
        `chain ${failed + 1} exited with code ${r?.code}${
          r && errorTail(r.stderr) ? `: ${errorTail(r.stderr)}` : ""
        }`,
      );
    }

    let samplesJson: string;
    try {
      const texts = csvPaths.map((path) => readFileSync(path, "utf8"));
      samplesJson = JSON.stringify(toMCMCChainsJson(fromStanCSVFiles(texts)));
      parseSamples(samplesJson);
    } catch (error) {
      return fail("load_samples", `could not read CmdStan output: ${(error as Error).message}`);
    }

    try {
      const partial = `${io.outPath}.tmp`;
      writeFileSync(partial, samplesJson);
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
      data_sha256: io.dataSha256 ?? sha256(canonicalJson(spec.data)),
      ...(io.dataFile ? { data_file: io.dataFile } : {}),
      samples_file: io.outPath,
      started_at: startedAt,
      elapsed_ms: Math.round(performance.now() - start),
    };
    try {
      writeFileSync(
        io.recordPath ?? `${io.outPath}.run.json`,
        `${JSON.stringify(record, null, 2)}\n`,
      );
    } catch (error) {
      return fail("write", `could not write the run record: ${(error as Error).message}`);
    }

    return {
      status: "ok",
      samplesFile: io.outPath,
      runtimeRequested,
      runtimeActual: install.version,
      elapsedMs: Math.round(performance.now() - start),
    };
  } finally {
    if (ownTmp) rmSync(tmp, { recursive: true, force: true });
  }
}
