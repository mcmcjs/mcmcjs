import { spawn } from "node:child_process";
import { type CommandRunner, interruptGuard, killTree } from "@mcmcjs/engine";
import pc from "picocolors";

// Match the engine's detached spawn so killTree can take down the whole group.
const DETACHED = process.platform !== "win32";
const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const TICK_MS = 120;
const WINDOW = 8; // recent log lines kept visible in the live tail
const TAIL_LINES = 40; // lines kept for the failure dump

// Coarse phase labels derived from juliaup/Pkg output, shown in the live header
// (and, off a TTY, as one line per change). Order matters only within a line.
const PHASES: Array<[RegExp, string]> = [
  [/installing julia|checking for new julia/i, "installing Julia"],
  [/resolving package/i, "resolving packages"],
  [/updating .*\.toml/i, "updating environment"],
  [/\b(installed|installing|downloading|downloaded|cloning|fetching)\b/i, "downloading"],
  [/precompil/i, "precompiling"],
];

/** The phase a line implies, or the current phase when nothing matches. */
export function detectPhase(line: string, current: string): string {
  for (const [re, label] of PHASES) {
    if (re.test(line)) return label;
  }
  return current;
}

export interface CollapsingOpts {
  /** Short description of the work (e.g. "preparing the Julia environment"). */
  label: string;
  timeoutMs: number;
  /** Injectable for tests; default to the real terminal. */
  isTTY?: boolean;
  columns?: number;
  rows?: number;
  write?: (text: string) => void;
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: matching ANSI escapes
const ANSI = /\x1b\[[0-9;?]*[A-Za-z]/g;

/**
 * A CommandRunner that shows a long, chatty subprocess live but cleans up after
 * itself. On a TTY it keeps a small fixed region in place: a spinner header with
 * the detected phase and elapsed time, above the last few real output lines.
 * The whole region is erased on success, so the firehose is shown while it
 * matters and gone once it is done. Off a TTY (no cursor control) it prints one
 * line per phase instead. Either way the output is captured and, on failure, its
 * tail is printed so the real error stays visible. Use createStreamingRunner
 * (--verbose) to keep the full raw output on screen.
 */
export function createCollapsingRunner(opts: CollapsingOpts): CommandRunner {
  const isTTY = opts.isTTY ?? process.stderr.isTTY === true;
  const write = opts.write ?? ((text: string) => void process.stderr.write(text));
  const columns = () => opts.columns ?? process.stderr.columns ?? 80;
  const windowCap = () =>
    Math.max(1, Math.min(WINDOW, (opts.rows ?? process.stderr.rows ?? 24) - 2));

  // One log line, stripped of escapes and any in-place redraw, clipped to width.
  const clip = (line: string) => {
    const visible = line.replace(ANSI, "").replace(/.*\r/, "").trimEnd();
    const max = Math.max(1, columns() - 1);
    return visible.length > max ? visible.slice(0, max) : visible;
  };

  return (command, args) =>
    new Promise<string>((resolve, reject) => {
      let phase = "";
      let pending = "";
      let frame = 0;
      let renderedRows = 0;
      let settled = false;
      const recent: string[] = []; // live tail window
      const tail: string[] = []; // failure dump
      const start = performance.now();
      const elapsed = () => Math.round((performance.now() - start) / 1000);

      // Move to the top of the region and clear downward (log-update style).
      const reset = () =>
        renderedRows > 0 ? `${renderedRows > 1 ? `\x1b[${renderedRows - 1}A` : ""}\r\x1b[0J` : "";
      const render = () => {
        const head = `${FRAMES[frame % FRAMES.length]} ${opts.label}${phase ? `: ${phase}` : ""}  ${elapsed()}s`;
        const lines = [head, ...recent.map((l) => pc.dim(clip(l)))];
        write(`${reset()}${lines.join("\n")}`);
        renderedRows = lines.length;
      };
      const clearRegion = () => {
        if (renderedRows > 0) {
          write(reset());
          renderedRows = 0;
        }
      };

      let timer: ReturnType<typeof setInterval> | undefined;
      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        if (timer) clearInterval(timer);
        clearTimeout(killer);
        dispose();
        if (isTTY) clearRegion();
        fn();
      };

      const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], detached: DETACHED });
      // On Ctrl+C, erase the live region before the kill so the terminal is left clean.
      const dispose = interruptGuard(child, () => isTTY && clearRegion());
      const killer = setTimeout(() => {
        killTree(child);
        finish(() =>
          reject(
            new Error(`${command} timed out after ${Math.round(opts.timeoutMs / 60_000)} min`),
          ),
        );
      }, opts.timeoutMs);

      if (isTTY) {
        render();
        timer = setInterval(() => {
          frame += 1;
          render();
        }, TICK_MS);
      } else {
        write(`${opts.label}...\n`);
      }

      const takeLine = (line: string) => {
        const text = line.trimEnd();
        if (text) {
          tail.push(text);
          if (tail.length > TAIL_LINES) tail.shift();
        }
        const prev = phase;
        phase = detectPhase(line, phase);
        if (isTTY) {
          if (text) {
            recent.push(line);
            while (recent.length > windowCap()) recent.shift();
          }
          render();
        } else if (phase && phase !== prev) {
          // Off a TTY there is no in-place region; mark each phase change once.
          write(`  ${phase}...\n`);
        }
      };
      const onData = (chunk: Buffer) => {
        pending += chunk.toString("utf8");
        for (;;) {
          const at = pending.indexOf("\n");
          if (at === -1) break;
          takeLine(pending.slice(0, at));
          pending = pending.slice(at + 1);
        }
      };

      child.stdout?.on("data", onData);
      child.stderr?.on("data", onData);
      child.on("error", (error) => finish(() => reject(error)));
      child.on("close", (code) => {
        if (pending) takeLine(pending);
        if (code === 0) {
          finish(() => resolve(""));
        } else {
          finish(() => {
            // Show the captured tail so a precompile/resolve error is not hidden.
            if (tail.length > 0) write(`${tail.join("\n")}\n`);
            reject(new Error(`${command} exited with code ${code}`));
          });
        }
      });
    });
}
