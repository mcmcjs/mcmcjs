import type { FitProgress } from "@mcmcjs/engine";

export interface ProgressRenderer {
  onProgress: (progress: FitProgress) => void;
  finish: () => void;
}

/** For --json runs: progress is consumed and nothing is rendered. */
export const silentProgress: ProgressRenderer = { onProgress: () => {}, finish: () => {} };

/** The renderer a command should use: silent under --json, stderr otherwise. */
export function rendererFor(json: boolean | undefined): ProgressRenderer {
  return json
    ? silentProgress
    : createProgressRenderer({
        tty: process.stderr.isTTY === true,
        write: (text) => process.stderr.write(text),
      });
}

const BAR_WIDTH = 24;
const STEP = 0.25;

function clamp(progress: FitProgress): number {
  const fraction = progress.done ? 1 : progress.fraction;
  return Number.isFinite(fraction) ? Math.min(1, Math.max(0, fraction)) : 0;
}

/**
 * Renders streamed sampling progress: a single updating status line on a TTY
 * (chains run serially, so one active bar is faithful), one plain line per 25%
 * step per chain otherwise.
 */
export function createProgressRenderer(opts: {
  tty: boolean;
  write: (text: string) => void;
}): ProgressRenderer {
  if (opts.tty) {
    let lastLength = 0;
    return {
      onProgress: (p) => {
        const fraction = clamp(p);
        const filled = Math.round(fraction * BAR_WIDTH);
        const bar = "#".repeat(filled) + ".".repeat(BAR_WIDTH - filled);
        const text = `sampling chain ${p.chain} of ${p.of}  [${bar}] ${Math.round(fraction * 100)}%`;
        opts.write(`\r${text.padEnd(lastLength)}`);
        lastLength = text.length;
      },
      finish: () => {
        if (lastLength > 0) opts.write(`\r${" ".repeat(lastLength)}\r`);
        lastLength = 0;
      },
    };
  }

  const nextStep = new Map<number, number>();
  return {
    onProgress: (p) => {
      const fraction = clamp(p);
      let threshold = nextStep.get(p.chain) ?? STEP;
      if (fraction + 1e-9 < threshold) return;
      while (threshold <= fraction + 1e-9) threshold += STEP;
      nextStep.set(p.chain, threshold);
      opts.write(`sampling chain ${p.chain} of ${p.of}: ${Math.round(fraction * 100)}%\n`);
    },
    finish: () => {},
  };
}
