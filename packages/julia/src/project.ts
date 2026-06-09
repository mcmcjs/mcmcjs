import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { type CommandRunner, createRunner } from "@mcmcjs/engine";

const PACKAGES = [
  "Turing",
  "MCMCChains",
  "JuliaBUGS",
  "AdvancedHMC",
  "ForwardDiff",
  "JSON",
  "StableRNGs",
];

/** The per-user directory holding the managed Julia project (Project + Manifest). */
export function managedProjectDir(): string {
  const base = process.env.XDG_DATA_HOME || join(homedir(), ".local", "share");
  return join(base, "mcmcjs", "julia", "env");
}

// Records the package set a managed dir was provisioned with, so an env from an
// older package set is healed (Pkg.add is additive) rather than left incomplete.
function sentinelPath(dir: string): string {
  return join(dir, ".mcmcjs-packages.json");
}

function provisioned(dir: string): boolean {
  try {
    return readFileSync(sentinelPath(dir), "utf8").trim() === JSON.stringify([...PACKAGES].sort());
  } catch {
    return false;
  }
}

/** Whether the managed project is present and provisioned with the current package set. */
export function managedProjectReady(dir: string = managedProjectDir()): boolean {
  return existsSync(join(dir, "Project.toml")) && provisioned(dir);
}

/**
 * Ensures the managed Julia project exists with the inference packages installed.
 * Idempotent: returns immediately when already provisioned with the current set,
 * otherwise adds (and precompiles) the missing packages. The first run resolves
 * and precompiles the project, which can take several minutes.
 */
export async function ensureProject(
  juliaBin: string,
  run: CommandRunner = createRunner(30 * 60_000),
  dir: string = managedProjectDir(),
): Promise<string> {
  if (managedProjectReady(dir)) return dir;
  mkdirSync(dir, { recursive: true });
  const code = `using Pkg; Pkg.add(${JSON.stringify(PACKAGES)}); Pkg.precompile()`;
  await run(juliaBin, ["--startup-file=no", `--project=${dir}`, "-e", code]);
  writeFileSync(sentinelPath(dir), JSON.stringify([...PACKAGES].sort()));
  return dir;
}
