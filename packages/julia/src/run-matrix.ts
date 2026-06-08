import { join } from "node:path";
import type { ResolvedSpec } from "@mcmcjs/core";
import type { FitResult, FitRunner } from "@mcmcjs/engine";
import { runFit } from "./fit";

export interface MatrixEntry {
  version: string;
  status: "ok" | "error";
  samplesFile?: string;
  runtimeActual?: string;
  elapsedMs: number;
  stage?: FitResult["stage"];
  error?: string;
}

export interface MatrixResult {
  entries: MatrixEntry[];
  /** True only when every requested version ran and succeeded. */
  ok: boolean;
}

export interface MatrixIo {
  spawn: FitRunner;
  projectDir: string;
  /** Directory the per-version samples files are written into. */
  outDir: string;
  /** Resolves a version/channel to a concrete invocation; injectable for tests. */
  resolve: (version: string) => Promise<{ command: string; args: string[] }>;
  /** Continue after a version fails instead of stopping. */
  keepGoing?: boolean;
}

/** Runs the same spec across several Julia versions, one samples file per version. */
export async function runMatrix(
  spec: ResolvedSpec,
  versions: string[],
  io: MatrixIo,
): Promise<MatrixResult> {
  const entries: MatrixEntry[] = [];
  for (const version of versions) {
    let entry: MatrixEntry;
    try {
      const resolved = await io.resolve(version);
      const versioned = { ...spec, backend: { ...spec.backend, version } };
      const result = await runFit(versioned, resolved, {
        spawn: io.spawn,
        projectDir: io.projectDir,
        outPath: join(io.outDir, `${version}.samples.json`),
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
    if (entry.status === "error" && !io.keepGoing) break;
  }
  return {
    entries,
    ok: entries.length === versions.length && entries.every((e) => e.status === "ok"),
  };
}
