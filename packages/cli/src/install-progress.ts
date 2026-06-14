import { spawn } from "node:child_process";
import type { CommandRunner } from "@mcmcjs/engine";

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const TICK_MS = 120;
const TAIL_LINES = 40;

// Coarse phase labels derived from juliaup/Pkg output, so the spinner can say
// what the long wait is doing. Order matters only within a single line.
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
  /** Injectable for tests; defaults to the real terminal. */
  isTTY?: boolean;
  columns?: number;
  write?: (text: string) => void;
}

/**
 * A CommandRunner that collapses a long, chatty subprocess into a single live
 * indicator. On a TTY it shows a spinner with the detected phase and elapsed
 * time, erased on success so no firehose is left in the scrollback. Off a TTY
 * it prints one line per phase change. Either way the output is captured and,
 * on failure, its tail is printed so the real error stays visible. Use
 * createStreamingRunner (--verbose) to see the full raw output instead.
 */
export function createCollapsingRunner(opts: CollapsingOpts): CommandRunner {
  const isTTY = opts.isTTY ?? process.stderr.isTTY === true;
  const write = opts.write ?? ((text: string) => void process.stderr.write(text));
  const columns = () => opts.columns ?? process.stderr.columns ?? 80;

  return (command, args) =>
    new Promise<string>((resolve, reject) => {
      let phase = "";
      let pending = "";
      let frame = 0;
      let lastLen = 0;
      let settled = false;
      const tail: string[] = [];
      const start = performance.now();
      const elapsed = () => Math.round((performance.now() - start) / 1000);

      const renderTty = () => {
        const text = `${FRAMES[frame % FRAMES.length]} ${opts.label}${phase ? `: ${phase}` : ""}  ${elapsed()}s`;
        const clipped = text.length > columns() - 1 ? text.slice(0, columns() - 1) : text;
        write(`\r${clipped.padEnd(lastLen)}`);
        lastLen = clipped.length;
      };

      let timer: ReturnType<typeof setInterval> | undefined;
      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        if (timer) clearInterval(timer);
        clearTimeout(killer);
        if (isTTY && lastLen > 0) write(`\r${" ".repeat(lastLen)}\r`);
        fn();
      };

      const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
      const killer = setTimeout(() => {
        child.kill("SIGKILL");
        finish(() =>
          reject(
            new Error(`${command} timed out after ${Math.round(opts.timeoutMs / 60_000)} min`),
          ),
        );
      }, opts.timeoutMs);

      if (isTTY) {
        renderTty();
        timer = setInterval(() => {
          frame += 1;
          renderTty();
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
        const next = detectPhase(line, phase);
        if (next !== phase) {
          phase = next;
          if (!isTTY) write(`  ${phase}...\n`);
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
