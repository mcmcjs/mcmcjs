import { fmtNum } from "./format";
import { linearScale, type Scale } from "./scale";
import { ticks } from "./ticks";

/** Categorical series palette (hex), cycled by index. */
export const PALETTE = [
  "#1f77b4",
  "#ff7f0e",
  "#2ca02c",
  "#d62728",
  "#9467bd",
  "#8c564b",
  "#17becf",
];

export function seriesColor(i: number): string {
  return PALETTE[i % PALETTE.length] as string;
}

const FONT = "12px ui-monospace, SFMono-Regular, Menlo, monospace";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export interface SvgFrameOptions {
  width: number;
  height: number;
  xDomain: [number, number];
  yDomain: [number, number];
  title?: string;
  xLabel?: string;
  yLabel?: string;
  /** Categorical row labels (one per slot) shown instead of numeric y-ticks. */
  yLabels?: string[];
}

export interface SvgFrame {
  /** Data-to-pixel scales for the plot area. */
  x: Scale;
  y: Scale;
  width: number;
  height: number;
  area: { left: number; right: number; top: number; bottom: number };
  /** Wraps plot-area content (pixel coords) in a white card, axes, ticks, and labels. */
  render(content: string): string;
}

/** A standalone axed SVG frame with nice-number ticks; the plot draws into its area. */
export function svgFrame(opts: SvgFrameOptions): SvgFrame {
  const left = 56;
  const right = opts.width - 16;
  const top = opts.title ? 28 : 12;
  const bottom = opts.height - 36;
  const x = linearScale(opts.xDomain, [left, right]);
  const y = linearScale(opts.yDomain, [bottom, top]); // SVG y grows downward
  const midX = (left + right) / 2;
  const midY = (top + bottom) / 2;

  const render = (content: string): string => {
    const p: string[] = [
      `<rect x="0" y="0" width="${opts.width}" height="${opts.height}" fill="#ffffff"/>`,
    ];
    if (opts.title) {
      p.push(
        `<text x="${midX}" y="18" text-anchor="middle" font-weight="bold" fill="#111">${esc(opts.title)}</text>`,
      );
    }
    p.push(`<line x1="${left}" y1="${bottom}" x2="${right}" y2="${bottom}" stroke="#333"/>`);
    p.push(`<line x1="${left}" y1="${top}" x2="${left}" y2="${bottom}" stroke="#333"/>`);
    if (opts.yLabels) {
      opts.yLabels.forEach((label, i) => {
        const py = y.map(i + 0.5);
        p.push(
          `<text x="${left - 7}" y="${py + 4}" text-anchor="end" fill="#333">${esc(label)}</text>`,
        );
      });
    } else {
      for (const t of ticks(opts.yDomain[0], opts.yDomain[1])) {
        const py = y.map(t);
        if (py < top - 0.5 || py > bottom + 0.5) continue;
        p.push(`<line x1="${left - 4}" y1="${py}" x2="${left}" y2="${py}" stroke="#333"/>`);
        p.push(
          `<text x="${left - 7}" y="${py + 4}" text-anchor="end" fill="#333">${esc(fmtNum(t))}</text>`,
        );
      }
    }
    for (const t of ticks(opts.xDomain[0], opts.xDomain[1])) {
      const px = x.map(t);
      if (px < left - 0.5 || px > right + 0.5) continue;
      p.push(`<line x1="${px}" y1="${bottom}" x2="${px}" y2="${bottom + 4}" stroke="#333"/>`);
      p.push(
        `<text x="${px}" y="${bottom + 17}" text-anchor="middle" fill="#333">${esc(fmtNum(t))}</text>`,
      );
    }
    if (opts.xLabel) {
      p.push(
        `<text x="${midX}" y="${opts.height - 4}" text-anchor="middle" fill="#333">${esc(opts.xLabel)}</text>`,
      );
    }
    if (opts.yLabel) {
      p.push(
        `<text x="14" y="${midY}" text-anchor="middle" fill="#333" transform="rotate(-90 14 ${midY})">${esc(opts.yLabel)}</text>`,
      );
    }
    p.push(content);
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${opts.width}" height="${opts.height}" viewBox="0 0 ${opts.width} ${opts.height}" font-family="${FONT}" font-size="12">${p.join("")}</svg>`;
  };

  return {
    x,
    y,
    width: opts.width,
    height: opts.height,
    area: { left, right, top, bottom },
    render,
  };
}

/** A polyline path through pixel points. */
export function svgPolyline(points: [number, number][], stroke: string, width = 1.25): string {
  if (points.length === 0) return "";
  const d = points
    .map(([px, py], i) => `${i === 0 ? "M" : "L"}${px.toFixed(2)} ${py.toFixed(2)}`)
    .join(" ");
  return `<path d="${d}" fill="none" stroke="${stroke}" stroke-width="${width}" stroke-opacity="0.85"/>`;
}

export function svgRect(x: number, y: number, w: number, h: number, fill: string): string {
  return `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${Math.max(0, w).toFixed(2)}" height="${Math.max(0, h).toFixed(2)}" fill="${fill}"/>`;
}

export interface SvgPathOptions {
  fill?: string;
  /** evenodd renders ring polygons with holes. */
  fillRule?: "nonzero" | "evenodd";
  fillOpacity?: number;
  stroke?: string;
  strokeWidth?: number;
  strokeDash?: string;
}

/** A raw path from pre-built `d` data (polygons, hexagons, contour rings). */
export function svgPath(d: string, opts: SvgPathOptions = {}): string {
  if (!d) return "";
  const parts = [`<path d="${d}"`, `fill="${opts.fill ?? "none"}"`];
  if (opts.fillRule) parts.push(`fill-rule="${opts.fillRule}"`);
  if (opts.fillOpacity !== undefined) parts.push(`fill-opacity="${opts.fillOpacity}"`);
  if (opts.stroke) parts.push(`stroke="${opts.stroke}"`);
  if (opts.strokeWidth !== undefined) parts.push(`stroke-width="${opts.strokeWidth}"`);
  if (opts.strokeDash) parts.push(`stroke-dasharray="${opts.strokeDash}"`);
  return `${parts.join(" ")}/>`;
}

/** Closed polygon path data from pixel points ("" for fewer than 3 points). */
export function polygonPathD(points: [number, number][]): string {
  if (points.length < 3) return "";
  const d = points
    .map(([px, py], i) => `${i === 0 ? "M" : "L"}${px.toFixed(2)} ${py.toFixed(2)}`)
    .join(" ");
  return `${d} Z`;
}

export function svgLine(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  stroke: string,
  width = 1,
): string {
  return `<line x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}" stroke="${stroke}" stroke-width="${width}"/>`;
}

export function svgCircle(cx: number, cy: number, r: number, fill: string): string {
  return `<circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${r}" fill="${fill}"/>`;
}

export function svgText(
  x: number,
  y: number,
  text: string,
  anchor: "start" | "middle" | "end" = "start",
): string {
  return `<text x="${x.toFixed(2)}" y="${y.toFixed(2)}" text-anchor="${anchor}" fill="#333">${esc(text)}</text>`;
}

/** Stacks standalone SVGs vertically into one document (each nested at a y offset). */
export function stackSvg(svgs: string[]): string {
  const items = svgs.filter(Boolean);
  if (items.length <= 1) return items[0] ?? "";
  const sized = items.map((s) => ({
    s,
    w: Number(/width="([\d.]+)"/.exec(s)?.[1] ?? 0),
    h: Number(/height="([\d.]+)"/.exec(s)?.[1] ?? 0),
  }));
  const maxW = Math.max(...sized.map((it) => it.w));
  const totalH = sized.reduce((sum, it) => sum + it.h, 0);
  let offset = 0;
  const children = sized.map(({ s, h }) => {
    const y = offset;
    offset += h;
    return s.replace("<svg ", `<svg y="${y}" `);
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${maxW}" height="${totalH}" viewBox="0 0 ${maxW} ${totalH}">${children.join("")}</svg>`;
}
