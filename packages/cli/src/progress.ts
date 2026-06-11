import type { FitProgress } from "@mcmcjs/engine";

export interface ProgressRenderer {
  onProgress: (progress: FitProgress) => void;
  finish: () => void;
}

/** For --json runs: progress is consumed and nothing is rendered. */
export const silentProgress: ProgressRenderer = { onProgress: () => {}, finish: () => {} };

const BAR_WIDTH = 24;
const STEP = 0.25;

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
        const fraction = p.done ? 1 : p.fraction;
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
      const fraction = p.done ? 1 : p.fraction;
      let threshold = nextStep.get(p.chain) ?? STEP;
      if (fraction + 1e-9 < threshold) return;
      while (threshold <= fraction + 1e-9) threshold += STEP;
      nextStep.set(p.chain, threshold);
      opts.write(`sampling chain ${p.chain} of ${p.of}: ${Math.round(fraction * 100)}%\n`);
    },
    finish: () => {},
  };
}
