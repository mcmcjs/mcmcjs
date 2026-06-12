import { homedir } from "node:os";
import { join } from "node:path";
import { type CommandRunner, createRunner, type ToolInfo } from "@mcmcjs/engine";

export type { CommandRunner, ToolInfo } from "@mcmcjs/engine";
export { createRunner } from "@mcmcjs/engine";

const defaultRunner = createRunner();

// juliaup installs its shims under the home directory; we also fall back to
// whatever is on PATH. $HOME is honored first so a sandbox that redirects HOME
// (mcmc sandbox --strict) finds its own juliaup, not the user's.
function candidates(binary: string): string[] {
  const home = process.env.HOME || homedir();
  return [join(home, ".juliaup", "bin", binary), binary];
}

async function detect(
  binary: string,
  parseVersion: (stdout: string) => string | undefined,
  runner: CommandRunner,
): Promise<ToolInfo> {
  for (const path of candidates(binary)) {
    try {
      const version = parseVersion(await runner(path, ["--version"]));
      if (version) return { found: true, version, path };
    } catch {
      // not available at this path; try the next candidate
    }
  }
  return { found: false };
}

const versionNumber = (stdout: string): string | undefined => stdout.match(/(\d+\.\d+\.\d+)/)?.[1];

/** Detects the Julia runtime via `julia --version`. */
export function detectJulia(runner: CommandRunner = defaultRunner): Promise<ToolInfo> {
  return detect("julia", versionNumber, runner);
}

/** Detects the juliaup version manager via `juliaup --version`. */
export function detectJuliaup(runner: CommandRunner = defaultRunner): Promise<ToolInfo> {
  return detect("juliaup", versionNumber, runner);
}
