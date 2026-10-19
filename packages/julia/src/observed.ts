import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ResolvedSpec } from "@mcmcjs/core";
import type { FitRunner } from "@mcmcjs/engine";
import { makeRequestDir } from "./fit";
import { driverPath, lastJsonLine } from "./runner-common";

export type ObservedValue = number | string | boolean | ObservedValue[];

export interface ObservedData {
  schema_version: 1;
  terms: { name: string; value: ObservedValue }[];
}

export interface ObservedIo {
  spawn: FitRunner;
  projectDir: string;
  outPath: string;
  samplesPath: string;
  tmpDir?: string;
}

export type ObservedResult =
  | {
      status: "ok";
      observedFile: string;
      runtimeRequested: string;
      runtimeActual?: string;
      elapsedMs: number;
    }
  | {
      status: "error";
      runtimeRequested: string;
      elapsedMs: number;
      stage?: string;
      error: string;
    };

function validValue(value: unknown): value is ObservedValue {
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "string" || typeof value === "boolean") return true;
  return Array.isArray(value) && value.every(validValue);
}

export function parseObservedData(text: string): ObservedData {
  const data: unknown = JSON.parse(text);
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new Error("observed data must be an object");
  }
  const payload = data as Record<string, unknown>;
  if (payload.schema_version !== 1 || !Array.isArray(payload.terms) || payload.terms.length === 0) {
    throw new Error("unsupported or empty observed data");
  }
  const seen = new Set<string>();
  for (const term of payload.terms) {
    if (typeof term !== "object" || term === null || Array.isArray(term)) {
      throw new Error("invalid observed term");
    }
    const item = term as Record<string, unknown>;
    if (
      typeof item.name !== "string" ||
      item.name.length === 0 ||
      seen.has(item.name) ||
      !validValue(item.value)
    ) {
      throw new Error("invalid or duplicate observed term");
    }
    seen.add(item.name);
  }
  return payload as unknown as ObservedData;
}

/** Records the values of the model's observed sites at the supplied posterior draws. */
export async function runObserved(
  spec: ResolvedSpec,
  resolved: { command: string; args: string[] },
  io: ObservedIo,
): Promise<ObservedResult> {
  const started = performance.now();
  const runtimeRequested = spec.backend.version;
  const ownTmp = io.tmpDir === undefined;
  const tmp = io.tmpDir ?? makeRequestDir("observed");
  const requestPath = join(tmp, "request.json");
  rmSync(io.outPath, { force: true });
  writeFileSync(
    requestPath,
    JSON.stringify({
      mode: "observed",
      schema_version: spec.schema_version,
      backend: { id: spec.backend.id },
      model: { file: spec.modelPath, entry: spec.model.entry },
      data: spec.data,
      samples: io.samplesPath,
      seed: spec.seed,
      out: io.outPath,
    }),
  );

  let stdout: string;
  let stderr: string;
  let code: number;
  try {
    ({ stdout, stderr, code } = await io.spawn(resolved.command, [
      ...resolved.args,
      "--startup-file=no",
      `--project=${io.projectDir}`,
      driverPath(),
      requestPath,
    ]));
  } finally {
    if (ownTmp) rmSync(tmp, { recursive: true, force: true });
  }
  const elapsedMs = Math.round(performance.now() - started);
  if (code !== 0 || !existsSync(io.outPath)) {
    const failure = lastJsonLine(stderr);
    return {
      status: "error",
      runtimeRequested,
      elapsedMs,
      stage: failure?.stage as string | undefined,
      error:
        (failure?.error as string | undefined) ??
        stderr.trim().split("\n").pop() ??
        `julia exited with code ${code}`,
    };
  }
  try {
    parseObservedData(readFileSync(io.outPath, "utf8"));
  } catch (error) {
    return {
      status: "error",
      runtimeRequested,
      elapsedMs,
      stage: "write",
      error: `observed data did not parse: ${(error as Error).message}`,
    };
  }
  const provenance = lastJsonLine(stdout);
  return {
    status: "ok",
    observedFile: io.outPath,
    runtimeRequested,
    runtimeActual: provenance?.julia_version as string | undefined,
    elapsedMs,
  };
}
