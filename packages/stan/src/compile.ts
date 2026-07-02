import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import type { CommandRunner } from "@mcmcjs/engine";
import { createRunner } from "@mcmcjs/engine";
import type { CmdStanInstall } from "./environment";
import { managedStanRoot } from "./environment";

export interface CompiledModel {
  /** Path to the compiled model executable. */
  binaryPath: string;
  /** True when a previously compiled binary was reused. */
  cached: boolean;
}

export interface CompileOptions {
  /** Runs make; injectable for tests. Compiles can take minutes. */
  runner?: CommandRunner;
  /** Cache root; defaults to `<managed>/models`. */
  cacheRoot?: string;
}

/**
 * Concatenates the source with any #include'd files (resolved against the
 * model's directory) so include edits invalidate the compile cache. Nested
 * includes resolve a few levels deep; unresolvable paths are left to stanc.
 */
export function cacheKeySource(source: string, modelDir: string, depth = 4): string {
  if (depth === 0) return source;
  const parts = [source];
  for (const match of source.matchAll(/^\s*#include\s+[<"']?([^>"'\s]+)[>"']?/gm)) {
    const file = match[1];
    if (!file) continue;
    try {
      const included = readFileSync(isAbsolute(file) ? file : join(modelDir, file), "utf8");
      parts.push(cacheKeySource(included, modelDir, depth - 1));
    } catch {
      // stanc reports missing includes with a proper error at compile time
    }
  }
  return parts.join("\n");
}

/** The compile cache directory for a model source on a CmdStan version. */
export function modelCacheDir(source: string, version: string, cacheRoot?: string): string {
  const key = createHash("sha256").update(`${version}\n${source}`).digest("hex").slice(0, 16);
  return join(cacheRoot ?? join(managedStanRoot(), "models"), key);
}

/**
 * Compiles a Stan model to an executable through CmdStan's make, cached by
 * source content and CmdStan version so edits recompile and reruns are instant.
 */
export async function compileModel(
  install: CmdStanInstall,
  modelPath: string,
  options: CompileOptions = {},
): Promise<CompiledModel> {
  const { runner = createRunner(10 * 60_000), cacheRoot } = options;
  const source = readFileSync(modelPath, "utf8");
  const modelDir = dirname(modelPath);
  const dir = modelCacheDir(cacheKeySource(source, modelDir), install.version, cacheRoot);
  const binaryPath = join(dir, "model");
  // The sentinel is written only after a successful make, so an interrupted
  // compile never gets reused as a valid binary.
  const okPath = join(dir, ".ok");
  if (existsSync(okPath) && existsSync(binaryPath)) return { binaryPath, cached: true };

  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "model.stan"), source);
  // CmdStan's pattern rules build targets outside its tree by absolute path;
  // includes still resolve against the original model's directory.
  await runner("make", ["-C", install.home, `STANCFLAGS=--include-paths=${modelDir}`, binaryPath]);
  if (!existsSync(binaryPath)) {
    throw new Error("make reported success but produced no model executable");
  }
  writeFileSync(okPath, "");
  return { binaryPath, cached: false };
}
