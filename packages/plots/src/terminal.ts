import type { ForestData, TerminalOptions, TraceData } from "./types";

// Unicode braille packs a 2x4 dot grid into one cell (base U+2800); these are
// the bit weights of each (row, col) dot, so a line can be drawn at ~2x4 the
// character resolution and still colored per cell.
// Braille dot bit weights over the cell's 2x4 grid, indexed by row*2 + col.
const DOT_BITS = [0x01, 0x08, 0x02, 0x10, 0x04, 0x20, 0x40, 0x80] as const;
const BRAILLE_BASE = 0x2800;
const ASCII_MARKERS = "o+x*#@%~";

const identity = (text: string): string => text;

/** Compact numeric label: fixed-ish width, exponential for extreme magnitudes. */
function fmtNum(n: number): string {
  if (!Number.isFinite(n)) return "n/a";
  const a = Math.abs(n);
  if (a !== 0 && (a < 1e-3 || a >= 1e5)) return n.toExponential(1);
  return Number(n.toFixed(3)).toString();
}

/** A draw region [min, max], padded slightly, with a fallback when all draws are equal. */
function bounds(values: Iterable<number>): [number, number] {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const v of values) {
    if (!Number.isFinite(v)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 1];
  if (min === max) return [min - 1, max + 1];
  const pad = (max - min) * 0.05;
  return [min - pad, max + pad];
}

/**
 * A virtual 2x4-per-cell dot grid. `set`/`line` plot in dot space (origin top
 * left); each cell remembers the last chain that touched it, so `render` can
 * color it. In ASCII mode a touched cell shows the chain's marker instead.
 */
class DotCanvas {
  readonly wDots: number;
  readonly hDots: number;
  private readonly cells: Uint8Array;
  private readonly cellChain: Int8Array;

  constructor(
    readonly wCells: number,
    readonly hCells: number,
  ) {
    this.wDots = wCells * 2;
    this.hDots = hCells * 4;
    this.cells = new Uint8Array(wCells * hCells);
    this.cellChain = new Int8Array(wCells * hCells).fill(-1);
  }

  set(px: number, py: number, chain: number): void {
    const x = Math.round(px);
    const y = Math.round(py);
    if (x < 0 || y < 0 || x >= this.wDots || y >= this.hDots) return;
    const idx = (y >> 2) * this.wCells + (x >> 1);
    this.cells[idx] = (this.cells[idx] ?? 0) | (DOT_BITS[(y & 3) * 2 + (x & 1)] ?? 0);
    this.cellChain[idx] = chain;
  }

  line(x0: number, y0: number, x1: number, y1: number, chain: number): void {
    let ax = Math.round(x0);
    let ay = Math.round(y0);
    const bx = Math.round(x1);
    const by = Math.round(y1);
    const dx = Math.abs(bx - ax);
    const dy = -Math.abs(by - ay);
    const sx = ax < bx ? 1 : -1;
    const sy = ay < by ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      this.set(ax, ay, chain);
      if (ax === bx && ay === by) break;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        ax += sx;
      }
      if (e2 <= dx) {
        err += dx;
        ay += sy;
      }
    }
  }

  rows(charset: "unicode" | "ascii", color: (text: string, chain: number) => string): string[] {
    const out: string[] = [];
    for (let cy = 0; cy < this.hCells; cy++) {
      let row = "";
      for (let cx = 0; cx < this.wCells; cx++) {
        const idx = cy * this.wCells + cx;
        const bits = this.cells[idx] ?? 0;
        const chain = this.cellChain[idx] ?? -1;
        if (bits === 0 || chain < 0) {
          row += " ";
          continue;
        }
        const glyph =
          charset === "ascii"
            ? (ASCII_MARKERS[chain % ASCII_MARKERS.length] ?? "?")
            : String.fromCharCode(BRAILLE_BASE + bits);
        row += color(glyph, chain);
      }
      out.push(row);
    }
    return out;
  }
}

const GUTTER = 8;

/** Renders a trace plot (one line per chain) as colored terminal text. */
export function renderTraceTerminal(data: TraceData, opts: TerminalOptions = {}): string {
  const charset = opts.charset ?? "unicode";
  const color = opts.color ?? identity;
  const totalWidth = opts.width ?? 72;
  const height = opts.height ?? 12;
  const plotW = Math.max(8, totalWidth - GUTTER - 2);
  const vbar = charset === "ascii" ? "|" : "┤";
  const corner = charset === "ascii" ? "+" : "└";
  const hbar = charset === "ascii" ? "-" : "─";

  const [ymin, ymax] = bounds(data.chains.flat());
  const canvas = new DotCanvas(plotW, height);
  const lastX = canvas.wDots - 1;
  const lastY = canvas.hDots - 1;
  const xAt = (i: number): number => (data.nDraws <= 1 ? 0 : (i / (data.nDraws - 1)) * lastX);
  const yAt = (v: number): number => (1 - (v - ymin) / (ymax - ymin)) * lastY;

  data.chains.forEach((series, chain) => {
    for (let i = 1; i < series.length; i++) {
      const prev = series[i - 1];
      const cur = series[i];
      if (prev === undefined || cur === undefined) continue;
      canvas.line(xAt(i - 1), yAt(prev), xAt(i), yAt(cur), chain);
    }
    const first = series[0];
    if (series.length === 1 && first !== undefined) canvas.set(0, yAt(first), chain);
  });

  const rhatStr = Number.isFinite(data.rhat) ? data.rhat.toFixed(3) : "n/a";
  const essStr = Number.isFinite(data.essBulk) ? String(Math.round(data.essBulk)) : "n/a";
  const lines: string[] = [
    `${data.variable}   R-hat ${rhatStr}   ESS ${essStr}   (${data.nChains} chains x ${data.nDraws} draws)`,
  ];

  const grid = canvas.rows(charset, color);
  grid.forEach((row, r) => {
    const label = r === 0 ? fmtNum(ymax) : r === grid.length - 1 ? fmtNum(ymin) : "";
    lines.push(`${label.padStart(GUTTER)} ${vbar}${row}`);
  });

  const pad = " ".repeat(GUTTER + 1);
  lines.push(`${pad}${corner}${hbar.repeat(plotW)}`);
  const left = "0";
  const right = String(data.nDraws);
  const between = Math.max(1, plotW - left.length - right.length);
  lines.push(`${pad}${left}${" ".repeat(between)}${right}`);

  return `${lines.join("\n")}\n`;
}

/** Renders a forest plot (point estimate + HDI + IQR per variable) as terminal text. */
export function renderForestTerminal(data: ForestData, opts: TerminalOptions = {}): string {
  const charset = opts.charset ?? "unicode";
  const warn = opts.warn ?? identity;
  const totalWidth = opts.width ?? 72;
  if (data.rows.length === 0) return "(no variables)\n";

  const hdiGlyph = charset === "ascii" ? "-" : "─";
  const iqrGlyph = charset === "ascii" ? "=" : "━";
  const meanGlyph = charset === "ascii" ? "*" : "●";

  const labelW = Math.min(20, Math.max(8, ...data.rows.map((r) => r.variable.length)));
  const annot = data.rows.map(
    (r) => `${fmtNum(r.mean)}  [${fmtNum(r.hdi[0])}, ${fmtNum(r.hdi[1])}]`,
  );
  const annotW = Math.max(...annot.map((a) => a.length));
  const axisW = Math.max(12, totalWidth - labelW - annotW - 6);

  let xmin = Number.POSITIVE_INFINITY;
  let xmax = Number.NEGATIVE_INFINITY;
  for (const r of data.rows) {
    xmin = Math.min(xmin, r.hdi[0], r.iqr[0]);
    xmax = Math.max(xmax, r.hdi[1], r.iqr[1]);
  }
  if (!Number.isFinite(xmin) || !Number.isFinite(xmax) || xmin === xmax) {
    xmin = (xmin || 0) - 1;
    xmax = (xmax || 0) + 1;
  }
  const col = (v: number): number =>
    Math.max(0, Math.min(axisW - 1, Math.round(((v - xmin) / (xmax - xmin)) * (axisW - 1))));

  const pct = Math.round(data.hdiProb * 100);
  const lines: string[] = [
    `${"parameter".padEnd(labelW)}  ${`mean & ${pct}% HDI`.padEnd(axisW)}  R-hat`,
  ];

  for (let i = 0; i < data.rows.length; i++) {
    const r = data.rows[i];
    if (!r) continue;
    const cells = new Array<string>(axisW).fill(" ");
    const [hl, hh] = [col(r.hdi[0]), col(r.hdi[1])];
    for (let c = hl; c <= hh; c++) cells[c] = hdiGlyph;
    const [il, ih] = [col(r.iqr[0]), col(r.iqr[1])];
    for (let c = il; c <= ih; c++) cells[c] = iqrGlyph;
    cells[col(r.mean)] = meanGlyph;

    const rhatStr = Number.isFinite(r.rhat) ? r.rhat.toFixed(3) : "n/a";
    const rhatCell = r.converged ? rhatStr : warn(`${rhatStr}!`);
    const label = r.variable.length > labelW ? `${r.variable.slice(0, labelW - 1)}…` : r.variable;
    lines.push(`${label.padEnd(labelW)}  ${cells.join("")}  ${rhatCell}   ${annot[i] ?? ""}`);
  }

  return `${lines.join("\n")}\n`;
}
