import type { Charset } from "./canvas";
import { fmtNum } from "./format";

export interface FrameOptions {
  /** Plot body width in character cells (the body rows' cell count). */
  width: number;
  /** y-axis range; the top row is labeled yMax, the bottom yMin. */
  yMin: number;
  yMax: number;
  /** Pre-formatted x-axis end labels. */
  xLeft: string;
  xRight: string;
  charset: Charset;
  /** Optional header line above the plot. */
  header?: string;
  /** Left gutter width for y labels (default 8). */
  gutter?: number;
}

/**
 * Wraps already-rendered body rows in an axed frame: a header, a left y-gutter
 * (labeled at top/bottom), a vertical axis, and a bottom x-axis with end labels.
 * Body rows may contain ANSI color, so the body width is passed explicitly
 * rather than measured from the strings.
 */
export function axisFrame(bodyRows: string[], opts: FrameOptions): string {
  const gutter = opts.gutter ?? 8;
  const vbar = opts.charset === "ascii" ? "|" : "┤";
  const corner = opts.charset === "ascii" ? "+" : "└";
  const hbar = opts.charset === "ascii" ? "-" : "─";

  const lines: string[] = [];
  if (opts.header !== undefined) lines.push(opts.header);
  bodyRows.forEach((row, r) => {
    const label = r === 0 ? fmtNum(opts.yMax) : r === bodyRows.length - 1 ? fmtNum(opts.yMin) : "";
    lines.push(`${label.padStart(gutter)} ${vbar}${row}`);
  });

  const pad = " ".repeat(gutter + 1);
  lines.push(`${pad}${corner}${hbar.repeat(opts.width)}`);
  const between = Math.max(1, opts.width - opts.xLeft.length - opts.xRight.length);
  lines.push(`${pad}${opts.xLeft}${" ".repeat(between)}${opts.xRight}`);

  return `${lines.join("\n")}\n`;
}
