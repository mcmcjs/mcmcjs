import { type ChildProcess, execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// On POSIX the child is its own process group leader (detached), so Ctrl+C can
// take down the whole tree (Julia plus any precompile workers) in one signal.
const DETACHED = process.platform !== "win32";

/** Force-kills a child and, on POSIX, its whole process group. */
export function killTree(child: ChildProcess): void {
  const pid = child.pid;
  if (pid === undefined) return;
  try {
    if (DETACHED) process.kill(-pid, "SIGKILL");
    else child.kill("SIGKILL");
  } catch {
    try {
      child.kill("SIGKILL");
    } catch {
      // already gone
    }
  }
}

/**
 * Force-kills the child (and its group) when this process is interrupted, then
 * exits 130. Without it, Ctrl+C takes Node's default exit while a Julia child
 * that defers SIGINT (mid-sampling or mid-precompile) keeps running. Returns a
 * disposer that removes the handlers once the child has settled.
 */
export function interruptGuard(child: ChildProcess, cleanup?: () => void): () => void {
  const onSignal = () => {
    cleanup?.();
    killTree(child);
    process.exit(130);
  };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);
  return () => {
    process.removeListener("SIGINT", onSignal);
    process.removeListener("SIGTERM", onSignal);
  };
}

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

/**
 * A CommandRunner that streams the child's stdout and stderr straight to this
 * process's stderr, so the user sees the subprocess's native output live
 * (juliaup download bars, Pkg precompile logs) during a long install or
 * provision instead of a static line. The output is shown, not captured, so it
 * resolves with an empty string; use createRunner when the output must be
 * parsed. Routing to stderr (fd 2) keeps stdout clean for --json callers.
 */
export function createStreamingRunner(timeoutMs = 30 * 60_000): CommandRunner {
  return (command, args) =>
    new Promise<string>((resolve, reject) => {
      let settled = false;
      const child = spawn(command, args, { stdio: ["ignore", 2, 2], detached: DETACHED });
      const dispose = interruptGuard(child);
      const settle = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        dispose();
        fn();
      };
      const timer = setTimeout(() => {
        killTree(child);
        settle(() =>
          reject(new Error(`${command} timed out after ${Math.round(timeoutMs / 60_000)} min`)),
        );
      }, timeoutMs);
      child.on("error", (error) => settle(() => reject(error)));
      child.on("close", (code) => {
        settle(() =>
          code === 0 ? resolve("") : reject(new Error(`${command} exited with code ${code}`)),
        );
      });
    });
}

/** One sampling progress update streamed from a runtime subprocess. */
export interface FitProgress {
  chain: number;
  of: number;
  fraction: number;
  done: boolean;
}

/**
 * A batch of sampled draws emitted as sampling proceeds. `draws` maps each
 * parameter's leaf name to the values produced in this batch (array-valued
 * parameters flatten to indexed leaves, e.g. `theta[1]`). `seq` is monotonic
 * per (run, chain) from 0, so a consumer can resume after a given batch;
 * concatenating a chain's batches in `seq` order reconstructs its draws.
 */
export interface DrawBatch {
  /** 0-based chain index. */
  chain: number;
  /** Monotonic per (run, chain), starting at 0. */
  seq: number;
  /** Iteration index at the end of this batch, or null. */
  iteration: number | null;
  /** Parameter leaf name -> the values produced in this batch. */
  draws: Record<string, number[]>;
}

/** Captures stdout, stderr, and exit code without throwing on a nonzero exit. */
export type FitRunner = (
  command: string,
  args: string[],
  opts?: {
    timeoutMs?: number;
    onProgress?: (progress: FitProgress) => void;
    onDraws?: (batch: DrawBatch) => void;
    /** Aborts the run: the child (and its group) is killed and `cancelled` is set. */
    signal?: AbortSignal;
  },
) => Promise<{ stdout: string; stderr: string; code: number; cancelled?: boolean }>;

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

/** Parses an mcmcjs draw-batch line; undefined for any other stderr content. */
export function parseDrawBatchLine(line: string): DrawBatch | undefined {
  const text = line.trim();
  if (!text.startsWith("{") || !text.includes('"mcmcjs"')) return undefined;
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    return undefined;
  }
  const record = doc as Record<string, unknown>;
  if (record.mcmcjs !== "draws") return undefined;
  const draws: Record<string, number[]> = {};
  for (const [name, values] of Object.entries((record.draws ?? {}) as Record<string, unknown>)) {
    draws[name] = Array.isArray(values) ? values.map(Number) : [];
  }
  const iteration = record.iteration;
  return {
    chain: Number(record.chain ?? 0),
    seq: Number(record.seq ?? 0),
    iteration: iteration === null || iteration === undefined ? null : Number(iteration),
    draws,
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
      let cancelled = false;
      let settled = false;

      const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], detached: DETACHED });
      // When the caller passes a signal it owns interruption (it can abort on
      // Ctrl+C itself), so the hard-exit guard would only race it; install the
      // guard only for the legacy no-signal path.
      const signal = opts?.signal;
      const onAbort = () => {
        cancelled = true;
        killTree(child);
      };
      const dispose = signal
        ? () => signal.removeEventListener("abort", onAbort)
        : interruptGuard(child);
      if (signal) {
        if (signal.aborted) onAbort();
        else signal.addEventListener("abort", onAbort, { once: true });
      }
      const settle = (result: {
        stdout: string;
        stderr: string;
        code: number;
        cancelled: boolean;
      }) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        dispose();
        done(result);
      };

      const timer = setTimeout(() => {
        timedOut = true;
        killTree(child);
      }, opts?.timeoutMs ?? timeoutMs);

      const takeLine = (line: string) => {
        const progress = parseProgressLine(line);
        if (progress) {
          opts?.onProgress?.(progress);
          return;
        }
        const batch = parseDrawBatchLine(line);
        if (batch) {
          opts?.onDraws?.(batch);
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
        settle({ stdout, stderr: stderr || error.message, code: 1, cancelled });
      });
      child.on("close", (code) => {
        if (pending) takeLine(pending);
        settle({
          stdout,
          stderr: timedOut ? `${stderr}process timed out and was killed\n` : stderr,
          code: code ?? 1,
          cancelled,
        });
      });
    });
}
