import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  canonicalJson,
  parseSamples,
  type ResolvedSpec,
  RUN_RECORD_SCHEMA_VERSION,
  type RunRecord,
} from "@mcmcjs/core";
import type { FitResult, FitRunner } from "@mcmcjs/engine";

const STAGES = new Set<NonNullable<FitResult["stage"]>>(["compile", "sample", "write", "spawn"]);

function toStage(value: unknown): FitResult["stage"] {
  return typeof value === "string" && STAGES.has(value as NonNullable<FitResult["stage"]>)
    ? (value as FitResult["stage"])
    : undefined;
}

export interface FitIo {
  /** Spawns the Julia process; injectable so runFit is testable without Julia. */
  spawn: FitRunner;
  /** The managed Julia project directory passed as --project. */
  projectDir: string;
  /** Where the samples file is written. */
  outPath: string;
  tmpDir?: string;
}

/** Path to the shipped Julia driver, resolved next to this module in dist/. */
function driverPath(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "driver.jl");
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function lastJsonLine(text: string): Record<string, unknown> | undefined {
  for (const line of text.trimEnd().split("\n").reverse()) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    try {
      return JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/** Runs one Turing inference for a resolved spec on a resolved runtime invocation. */
export async function runFit(
  spec: ResolvedSpec,
  resolved: { command: string; args: string[] },
  io: FitIo,
): Promise<FitResult> {
  const startedAt = new Date().toISOString();
  const start = performance.now();
  const runtimeRequested = spec.backend.version;

  const tmp = io.tmpDir ?? mkdtempSync(join(tmpdir(), "mcmcjs-fit-"));
  const requestPath = join(tmp, "request.json");
  writeFileSync(
    requestPath,
    JSON.stringify({
      schema_version: spec.schema_version,
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
  const { stdout, stderr, code } = await io.spawn(resolved.command, args);
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
  writeFileSync(`${io.outPath}.run.json`, `${JSON.stringify(record, null, 2)}\n`);

  return {
    status: "ok",
    samplesFile: io.outPath,
    runtimeRequested,
    runtimeActual: julia,
    elapsedMs,
  };
}
