/** Glyph set for a canvas: high-resolution Unicode braille, or plain ASCII. */
export type Charset = "unicode" | "ascii";

/** Colorizes a glyph for a given series index; identity when a caller has no color library. */
export type ColorFn = (text: string, series: number) => string;

// Unicode braille packs a 2x4 dot grid into one character (base U+2800); these
// are the bit weights of each dot, indexed by row*2 + col, so a line can be
// drawn at ~2x4 the character resolution and still colored per cell.
const DOT_BITS = [0x01, 0x08, 0x02, 0x10, 0x04, 0x20, 0x40, 0x80] as const;
const BRAILLE_BASE = 0x2800;
const ASCII_MARKERS = "o+x*#@%~";

/**
 * A virtual 2x4-per-cell dot grid. `set`/`line` plot in dot space (origin top
 * left); each cell remembers the last series that touched it, so `rows` can
 * color it. In ASCII mode a touched cell shows that series' marker instead of
 * a braille glyph. Pure: no DOM, no dependencies.
 */
export class DotCanvas {
  readonly wDots: number;
  readonly hDots: number;
  private readonly cells: Uint8Array;
  private readonly cellSeries: Int8Array;

  constructor(
    readonly wCells: number,
    readonly hCells: number,
  ) {
    this.wDots = wCells * 2;
    this.hDots = hCells * 4;
    this.cells = new Uint8Array(wCells * hCells);
    this.cellSeries = new Int8Array(wCells * hCells).fill(-1);
  }

  set(px: number, py: number, series: number): void {
    const x = Math.round(px);
    const y = Math.round(py);
    if (x < 0 || y < 0 || x >= this.wDots || y >= this.hDots) return;
    const idx = (y >> 2) * this.wCells + (x >> 1);
    this.cells[idx] = (this.cells[idx] ?? 0) | (DOT_BITS[(y & 3) * 2 + (x & 1)] ?? 0);
    this.cellSeries[idx] = series;
  }

  /** Plots a straight line between two dot-space points (integer Bresenham). */
  line(x0: number, y0: number, x1: number, y1: number, series: number): void {
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
      this.set(ax, ay, series);
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

  /** Renders the grid to one string per character row, colorized per cell. */
  rows(charset: Charset, color: ColorFn): string[] {
    const out: string[] = [];
    for (let cy = 0; cy < this.hCells; cy++) {
      let row = "";
      for (let cx = 0; cx < this.wCells; cx++) {
        const idx = cy * this.wCells + cx;
        const bits = this.cells[idx] ?? 0;
        const series = this.cellSeries[idx] ?? -1;
        if (bits === 0 || series < 0) {
          row += " ";
          continue;
        }
        const glyph =
          charset === "ascii"
            ? (ASCII_MARKERS[series % ASCII_MARKERS.length] ?? "?")
            : String.fromCharCode(BRAILLE_BASE + bits);
        row += color(glyph, series);
      }
      out.push(row);
    }
    return out;
  }
}
