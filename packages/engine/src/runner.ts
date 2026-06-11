import { execFile, spawn } from "node:child_process";
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

/** One sampling progress update streamed from a runtime subprocess. */
export interface FitProgress {
  chain: number;
  of: number;
  fraction: number;
  done: boolean;
}

/** Captures stdout, stderr, and exit code without throwing on a nonzero exit. */
export type FitRunner = (
  command: string,
  args: string[],
  opts?: { timeoutMs?: number; onProgress?: (progress: FitProgress) => void },
) => Promise<{ stdout: string; stderr: string; code: number }>;

/** Parses an mcmcjs progress line; undefined for any other stderr content. */
export function parseProgressLine(line: string): FitProgress | undefined {
  const text = line.trim();
  if (!text.startsWith("{") || !text.includes('"mcmcjs"')) return undefined;
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    return undefined;
  }
  const record = doc as Record<string, unknown>;
  if (record.mcmcjs !== "progress") return undefined;
  return {
    chain: Number(record.chain ?? 1),
    of: Number(record.of ?? 1),
    fraction: Number(record.fraction ?? 0),
    done: Boolean(record.done),
  };
}

const MAX_CAPTURE = 64 * 1024 * 1024;

/**
 * Creates a FitRunner backed by spawn, suited to long-running inference
 * processes. stderr is consumed line by line as it arrives: progress lines go
 * to onProgress and are kept out of the returned stderr, so the failure
 * protocol's last-JSON-line parse never sees them.
 */
export function createFitRunner(timeoutMs = 30 * 60_000): FitRunner {
  return (command, args, opts) =>
    new Promise((done) => {
      let stdout = "";
      let stderr = "";
      let pending = "";
      let timedOut = false;
      let settled = false;

      const settle = (result: { stdout: string; stderr: string; code: number }) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        done(result);
      };

      const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGKILL");
      }, opts?.timeoutMs ?? timeoutMs);

      const takeLine = (line: string) => {
        const progress = parseProgressLine(line);
        if (progress) {
          opts?.onProgress?.(progress);
          return;
        }
        if (stderr.length < MAX_CAPTURE) stderr += `${line}\n`;
      };

      child.stdout.on("data", (chunk: Buffer) => {
        if (stdout.length < MAX_CAPTURE) stdout += chunk.toString("utf8");
      });
      child.stderr.on("data", (chunk: Buffer) => {
        pending += chunk.toString("utf8");
        for (;;) {
          const at = pending.indexOf("\n");
          if (at === -1) break;
          takeLine(pending.slice(0, at));
          pending = pending.slice(at + 1);
        }
      });
      child.on("error", (error) => {
        settle({ stdout, stderr: stderr || error.message, code: 1 });
      });
      child.on("close", (code) => {
        if (pending) takeLine(pending);
        settle({
          stdout,
          stderr: timedOut ? `${stderr}fit timed out and was killed\n` : stderr,
          code: code ?? 1,
        });
      });
    });
}
