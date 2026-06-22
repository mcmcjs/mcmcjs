import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { FitResult } from "@mcmcjs/engine";

/**
 * The per-user parent for all mcmcjs temp state. The uid suffix keeps users
 * on a shared /tmp out of each other's way (macOS tmpdir is per-user already,
 * Linux /tmp is not).
 */
export function sharedTmpParent(): string {
  const uid = typeof process.getuid === "function" ? `-${process.getuid()}` : "";
  return join(tmpdir(), `mcmcjs${uid}`);
}

// The driver scripts sit next to the bundle in the published dist/ (tsup copies
// them there), but under src/driver/ when running from source (tests, tsx). Try
// the bundle layout first, fall back to the source layout.
function driverFile(name: string): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const beside = join(here, name);
  return existsSync(beside) ? beside : join(here, "driver", name);
}

/** Path to the shipped Julia driver. */
export function driverPath(): string {
  return driverFile("driver.jl");
}

/** Path to the shipped persistent worker. */
export function workerPath(): string {
  return driverFile("worker.jl");
}

/**
 * Directory holding the shipped, resolved Julia env (Project.toml + Manifest.toml),
 * next to this module in dist/. A fresh default provision instantiates this exact
 * package set rather than re-resolving the latest compatible versions.
 */
export function pinnedEnvDir(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "julia-env");
}

export function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** Parses the last JSON-object line of text (the driver's provenance or error line). */
export function lastJsonLine(text: string): Record<string, unknown> | undefined {
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

const STAGES = new Set<NonNullable<FitResult["stage"]>>([
  "compile",
  "sample",
  "load_samples",
  "predict",
  "write",
  "spawn",
  "worker",
]);

/** Narrows a driver-reported stage string to the known set. */
export function toStage(value: unknown): FitResult["stage"] {
  return typeof value === "string" && STAGES.has(value as NonNullable<FitResult["stage"]>)
    ? (value as FitResult["stage"])
    : undefined;
}
