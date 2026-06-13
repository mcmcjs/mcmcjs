import type { FitProgress } from "@mcmcjs/engine";

export interface ProgressRenderer {
  /** Shows an initial "starting" indicator before the first progress arrives. */
  start?: () => void;
  onProgress: (progress: FitProgress) => void;
  finish: () => void;
}

/** For --json runs: progress is consumed and nothing is rendered. */
export const silentProgress: ProgressRenderer = { onProgress: () => {}, finish: () => {} };

/** The renderer a command should use: silent under --json, stderr otherwise. */
export function rendererFor(json: boolean | undefined, backend?: string): ProgressRenderer {
  if (json) return silentProgress;
  const renderer = createProgressRenderer({
    tty: process.stderr.isTTY === true,
    write: (text) => process.stderr.write(text),
    starting: `starting Julia and loading ${backend ?? "the inference backend"}...`,
  });
  // Julia start + backend load is silent for ~15s before the first chain; show
  // something so the wait is never a dead screen.
  renderer.start?.();
  return renderer;
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
 * step per chain otherwise. The optional `starting` line is printed plainly
 * (newline-terminated) so it never collides with other stdout/stderr output.
 */
export function createProgressRenderer(opts: {
  tty: boolean;
  write: (text: string) => void;
  starting?: string;
}): ProgressRenderer {
  const start = opts.starting ? () => opts.write(`${opts.starting}\n`) : undefined;

  if (opts.tty) {
    let lastLength = 0;
    return {
      start,
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
    start,
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
