import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { type CommandRunner, createRunner } from "@mcmcjs/engine";

const PACKAGES = ["Turing", "MCMCChains", "JSON", "StableRNGs"];

/** The per-user directory holding the managed Julia project (Project + Manifest). */
export function managedProjectDir(): string {
  const base = process.env.XDG_DATA_HOME || join(homedir(), ".local", "share");
  return join(base, "mcmcjs", "julia", "env");
}

/**
 * Ensures the managed Julia project exists with the inference packages installed.
 * Idempotent: skips provisioning when the project is already present. The first
 * run resolves and precompiles the project, which can take several minutes.
 */
export async function ensureProject(
  juliaBin: string,
  run: CommandRunner = createRunner(30 * 60_000),
  dir: string = managedProjectDir(),
): Promise<string> {
  if (existsSync(join(dir, "Project.toml"))) return dir;
  mkdirSync(dir, { recursive: true });
  const code = `using Pkg; Pkg.add(${JSON.stringify(PACKAGES)}); Pkg.precompile()`;
  await run(juliaBin, ["--startup-file=no", `--project=${dir}`, "-e", code]);
  return dir;
}
