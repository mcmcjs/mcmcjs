import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Information about a detected command-line tool. */
export interface ToolInfo {
  found: boolean;
  version?: string;
  path?: string;
}

/** Runs a command and resolves its stdout. Injectable so detection is testable. */
export type CommandRunner = (command: string, args: string[]) => Promise<string>;

const defaultRunner: CommandRunner = async (command, args) => {
  const { stdout } = await execFileAsync(command, args, { timeout: 10_000 });
  return stdout;
};

// juliaup installs its shims here; we also fall back to whatever is on PATH.
function candidates(binary: string): string[] {
  return [join(homedir(), ".juliaup", "bin", binary), binary];
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
