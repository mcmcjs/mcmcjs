import { join } from "node:path";
import type { ResolvedSpec } from "@mcmcjs/core";
import type { FitResult } from "@mcmcjs/engine";
import { resolveCmdStan } from "./environment";
import { runFit, type StanFitIo } from "./fit";

// Structurally identical to the Julia engine's matrix shapes, so the CLI's
// matrix rendering works with either engine's result.
export interface StanMatrixEntry {
  version: string;
  status: "ok" | "error" | "cancelled";
  samplesFile?: string;
  runtimeActual?: string;
  elapsedMs: number;
  stage?: FitResult["stage"];
  error?: string;
}

export interface StanMatrixResult {
  entries: StanMatrixEntry[];
  /** True only when every requested version ran and succeeded. */
  ok: boolean;
}

export interface StanMatrixIo {
  /** Directory the per-version samples files are written into. */
  outDir: string;
  dataFile?: string;
  dataSha256?: string;
  /** Continue after a version fails instead of stopping. */
  keepGoing?: boolean;
  signal?: AbortSignal;
  /** Fit pass-through, injectable for tests. */
  fit?: Pick<StanFitIo, "spawn" | "compile">;
}

/** Runs one spec across several installed CmdStan versions. */
export async function runMatrix(
  spec: ResolvedSpec,
  versions: string[],
  io: StanMatrixIo,
): Promise<StanMatrixResult> {
  const entries: StanMatrixEntry[] = [];
  for (const version of versions) {
    let entry: StanMatrixEntry;
    try {
      const install = resolveCmdStan(version);
      const result = await runFit({ ...spec, backend: { ...spec.backend, version } }, install, {
        ...io.fit,
        outPath: join(io.outDir, `${version}.samples.json`),
        dataFile: io.dataFile,
        dataSha256: io.dataSha256,
        signal: io.signal,
      });
      entry = {
        version,
        status: result.status,
        samplesFile: result.samplesFile,
        runtimeActual: result.runtimeActual,
        elapsedMs: result.elapsedMs,
        stage: result.stage,
        error: result.error,
      };
    } catch (error) {
      entry = { version, status: "error", elapsedMs: 0, error: (error as Error).message };
    }
    entries.push(entry);
    if (entry.status === "cancelled") break;
    if (entry.status === "error" && !io.keepGoing) break;
  }
  return {
    entries,
    ok: entries.length === versions.length && entries.every((e) => e.status === "ok"),
  };
}
