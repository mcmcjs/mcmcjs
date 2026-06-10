import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export const STORE_DIR_NAME = ".mcmc";

/** Walks up from `fromDir` looking for an existing store directory. */
export function findStore(fromDir: string): string | undefined {
  let dir = resolve(fromDir);
  for (;;) {
    const candidate = join(dir, STORE_DIR_NAME);
    if (existsSync(candidate) && statSync(candidate).isDirectory()) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

/**
 * Resolves the store directory for an input file: an explicit override wins,
 * then the nearest existing store above the input, then a new store beside it.
 */
export function storeDirFor(inputPath: string, override?: string): string {
  if (override) return resolve(override);
  const inputDir = dirname(resolve(inputPath));
  return findStore(inputDir) ?? join(inputDir, STORE_DIR_NAME);
}

/** Creates the store layout if needed; the .gitignore makes it invisible to git. */
export function ensureStore(storeDir: string): void {
  mkdirSync(join(storeDir, "runs"), { recursive: true });
  const gitignore = join(storeDir, ".gitignore");
  if (!existsSync(gitignore)) writeFileSync(gitignore, "*\n");
}

export function runDir(storeDir: string, runId: string): string {
  return join(storeDir, "runs", runId);
}
