import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { FitResult } from "@mcmcjs/engine";

/** Path to the shipped Julia driver, resolved next to this module in dist/. */
export function driverPath(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "driver.jl");
}

/** Path to the shipped persistent worker, resolved next to this module in dist/. */
export function workerPath(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "worker.jl");
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
