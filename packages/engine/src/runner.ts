import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Information about a detected command-line tool. */
export interface ToolInfo {
  found: boolean;
  version?: string;
  path?: string;
}

/** Runs a command and resolves its stdout. Injectable so callers stay testable. */
export type CommandRunner = (command: string, args: string[]) => Promise<string>;

/** Creates a runner backed by execFile with the given timeout in milliseconds. */
export function createRunner(timeoutMs = 10_000): CommandRunner {
  return async (command, args) => {
    const { stdout } = await execFileAsync(command, args, {
      timeout: timeoutMs,
      maxBuffer: 16 * 1024 * 1024,
    });
    return stdout;
  };
}

/** Captures stdout, stderr, and exit code without throwing on a nonzero exit. */
export type FitRunner = (
  command: string,
  args: string[],
  opts?: { timeoutMs?: number },
) => Promise<{ stdout: string; stderr: string; code: number }>;

/** Creates a FitRunner backed by execFile, suited to long-running inference processes. */
export function createFitRunner(timeoutMs = 30 * 60_000): FitRunner {
  return async (command, args, opts) => {
    try {
      const { stdout, stderr } = await execFileAsync(command, args, {
        timeout: opts?.timeoutMs ?? timeoutMs,
        maxBuffer: 64 * 1024 * 1024,
      });
      return { stdout, stderr, code: 0 };
    } catch (error) {
      const e = error as { stdout?: string; stderr?: string; code?: unknown; message?: string };
      return {
        stdout: e.stdout ?? "",
        stderr: e.stderr ?? e.message ?? String(error),
        code: typeof e.code === "number" ? e.code : 1,
      };
    }
  };
}
