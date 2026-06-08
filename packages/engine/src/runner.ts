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
