import { type ChildProcess, spawn } from "node:child_process";
import { killTree } from "@mcmcjs/engine";

const DETACHED = process.platform !== "win32";

export interface StanSpawnResult {
  code: number;
  stderr: string;
  cancelled?: boolean;
}

export interface StanSpawnOptions {
  /** Called once per complete stdout line (CmdStan prints progress there). */
  onStdoutLine?: (line: string) => void;
  signal?: AbortSignal;
  timeoutMs?: number;
}

/** Spawns one CmdStan process, streaming stdout lines to the caller. */
export type StanSpawn = (
  command: string,
  args: string[],
  opts?: StanSpawnOptions,
) => Promise<StanSpawnResult>;

const STDERR_LIMIT = 1 << 22;

/**
 * The production StanSpawn: detached on POSIX so cancellation kills the whole
 * process group, stdout parsed line-by-line for progress, stderr captured for
 * error reporting.
 */
export function createStanSpawn(defaultTimeoutMs = 30 * 60_000): StanSpawn {
  return (command, args, opts = {}) =>
    new Promise((resolve) => {
      const child: ChildProcess = spawn(command, args, {
        stdio: ["ignore", "pipe", "pipe"],
        detached: DETACHED,
      });

      let stderr = "";
      let stdoutPending = "";
      let cancelled = false;
      let settled = false;

      const timeoutMs = opts.timeoutMs ?? defaultTimeoutMs;
      const timer = setTimeout(() => {
        stderr += "process timed out and was killed\n";
        killTree(child);
      }, timeoutMs);
      timer.unref?.();

      const onAbort = () => {
        cancelled = true;
        killTree(child);
      };
      if (opts.signal) {
        if (opts.signal.aborted) onAbort();
        else opts.signal.addEventListener("abort", onAbort, { once: true });
      }

      child.stdout?.on("data", (data: Buffer) => {
        stdoutPending += data.toString("utf8");
        for (;;) {
          const nl = stdoutPending.indexOf("\n");
          if (nl < 0) break;
          opts.onStdoutLine?.(stdoutPending.slice(0, nl));
          stdoutPending = stdoutPending.slice(nl + 1);
        }
      });
      child.stderr?.on("data", (data: Buffer) => {
        if (stderr.length < STDERR_LIMIT) stderr += data.toString("utf8");
      });

      const settle = (code: number) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        opts.signal?.removeEventListener("abort", onAbort);
        if (stdoutPending.length > 0) opts.onStdoutLine?.(stdoutPending);
        resolve({ code, stderr, cancelled: cancelled || undefined });
      };

      child.on("error", (error) => {
        stderr = stderr || error.message;
        settle(1);
      });
      child.on("close", (code) => settle(code ?? 1));
    });
}

/** Parses one CmdStan progress line; null when the line is not progress. */
export function parseIterationLine(
  line: string,
): { iteration: number; total: number; warmup: boolean } | null {
  const match = line.match(/Iteration:\s*(\d+)\s*\/\s*(\d+)\s*\[\s*\d+%\]\s*\((Warmup|Sampling)\)/);
  if (!match) return null;
  return {
    iteration: Number.parseInt(match[1] ?? "0", 10),
    total: Number.parseInt(match[2] ?? "0", 10),
    warmup: match[3] === "Warmup",
  };
}
