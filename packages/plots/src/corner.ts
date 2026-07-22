import { wongColor } from "@mcmcjs/charts";
import { chainView, type Samples } from "@mcmcjs/core";
import { essBulk } from "@mcmcjs/diagnostics";

// Corner (pair) plots modeled on PairPlots.jl: an N x N grid of 1-D marginals
// on the diagonal and layered 2-D joint views in the body, with sigma-mass KDE
// contours, ESS-driven bandwidths and bin counts, and tiered default styling.

export interface ScatterViz {
  type: "scatter";
  /** Drop points inside this sigma's contour (PairPlots filtersigma). */
  filtersigma?: number;
  markersize?: number;
  color?: string;
}
export interface HexBinViz {
  type: "hexbin";
  bins?: number;
  color?: string;
}
export interface Hist2dViz {
  type: "hist2d";
  bins?: number;
  color?: string;
}
export interface ContourViz {
  type: "contour";
  sigmas?: number[];
  bandwidth?: number;
  linewidth?: number;
  color?: string;
}
export interface ContourfViz {
  type: "contourf";
  sigmas?: number[];
  bandwidth?: number;
  alpha?: number;
  color?: string;
}
export interface TrendLineViz {
  type: "trendline";
  color?: string;
}
export interface CorrelationViz {
  type: "correlation";
  digits?: number;
  position?: [number, number];
}
export type CornerBodyViz =
  | ScatterViz
  | HexBinViz
  | Hist2dViz
  | ContourViz
  | ContourfViz
  | TrendLineViz
  | CorrelationViz;

export interface MarginHistViz {
  type: "marginhist";
  bins?: number;
  color?: string;
}
export interface MarginStepHistViz {
  type: "marginstephist";
  bins?: number;
  color?: string;
}
export interface MarginDensityViz {
  type: "margindensity";
  bandwidth?: number;
  linewidth?: number;
  color?: string;
}
export interface MarginQuantileTextViz {
  type: "marginquantiletext";
  quantiles?: [number, number, number];
}
export interface MarginQuantileLinesViz {
  type: "marginquantilelines";
  quantiles?: [number, number, number];
}
export type CornerDiagViz =
  | MarginHistViz
  | MarginStepHistViz
  | MarginDensityViz
  | MarginQuantileTextViz
  | MarginQuantileLinesViz;

export type CornerViz = CornerBodyViz | CornerDiagViz;

export interface CornerSeries {
  samples: Samples;
  label?: string;
  color?: string;
  /** Per-variable bin-count overrides. */
  bins?: Record<string, number>;
  /** Layer stack; omitted layers come from the tiered defaults by series count. */
  viz?: CornerViz[];
}

export interface CornerTruth {
  values: Record<string, number | number[]>;
  label?: string;
  color?: string;
}

export interface CornerBand {
  ranges: Record<string, [number, number]>;
  label?: string;
  color?: string;
  alpha?: number;
}

export interface CornerOptions {
  /** Variables to plot; defaults to the ordered union across series. */
  vars?: string[];
  labels?: Record<string, string>;
  /** Duplicate the body into the upper triangle. */
  fullgrid?: boolean;
  truth?: CornerTruth[];
  band?: CornerBand[];
}

export interface CornerRing {
  x: number[];
  y: number[];
}
export interface CornerPolygon {
  /** First ring is the outer boundary; the rest are holes. */
  rings: CornerRing[];
}

export type CornerBodyLayer =
  | {
      type: "hexbin";
      seriesIndex: number;
      color: string;
      cx: number[];
      cy: number[];
      weight: number[];
      wmax: number;
      /** Pointy-top hexagon geometry: vertex half-width and y circumradius. */
      hexX: number;
      hexY: number;
    }
  | {
      type: "hist2d";
      seriesIndex: number;
      color: string;
      x: number[];
      y: number[];
      weights: number[][];
      wmax: number;
    }
  | { type: "contour"; seriesIndex: number; color: string; linewidth: number; curves: CornerRing[] }
  | {
      type: "contourf";
      seriesIndex: number;
      color: string;
      alpha: number;
      polygons: CornerPolygon[];
    }
  | {
      type: "scatter";
      seriesIndex: number;
      color: string;
      markersize: number;
      x: number[];
      y: number[];
    }
  | { type: "trendline"; seriesIndex: number; color: string; m: number; b: number }
  | {
      type: "correlation";
      seriesIndex: number;
      value: number;
      digits: number;
      position: [number, number];
    }
  | { type: "bodylines"; seriesIndex: number; color: string; xs: number[]; ys: number[] }
  | {
      type: "bodybands";
      seriesIndex: number;
      color: string;
      alpha: number;
      x: [number, number][];
      y: [number, number][];
    };

export type CornerDiagLayer =
  | { type: "marginhist"; seriesIndex: number; color: string; x: number[]; weights: number[] }
  | { type: "marginstephist"; seriesIndex: number; color: string; x: number[]; weights: number[] }
  | {
      type: "margindensity";
      seriesIndex: number;
      color: string;
      linewidth: number;
      x: number[];
      y: number[];
    }
  | {
      type: "marginquantilelines";
      seriesIndex: number;
      color: string;
      values: [number, number, number];
    }
  | { type: "marginlines"; seriesIndex: number; color: string; values: number[] }
  | {
      type: "marginbands";
      seriesIndex: number;
      color: string;
      alpha: number;
      ranges: [number, number][];
    };

export interface CornerTitle {
  seriesIndex: number;
  color: string;
  text: string;
  low: number;
  mid: number;
  high: number;
}

export interface CornerCell {
  row: number;
  col: number;
  layers: CornerBodyLayer[];
}
export interface CornerDiagCell {
  index: number;
  layers: CornerDiagLayer[];
  titles: CornerTitle[];
}

export interface CornerData {
  kind: "corner";
  vars: string[];
  labels: string[];
  /** Linked per-variable axis domains across every series, truth, and band. */
  domains: [number, number][];
  series: { label?: string; color: string }[];
  diagonal: boolean;
  fullgrid: boolean;
  cells: CornerCell[];
  diags: CornerDiagCell[];
}

const GRID_N = 100;
const DENSITY_N = 100;

// PairPlots' tiered defaults: grayscale for one series, wong-colored overlays
// for up to five, contour-only beyond that.
const SINGLE_SERIES_COLOR = "rgba(0,0,0,0.5)";
const SINGLE_SERIES_VIZ: CornerViz[] = [
  { type: "hexbin", color: "#333333" },
  { type: "scatter", filtersigma: 2 },
  { type: "contour", linewidth: 1.5 },
  { type: "marginhist", color: "rgba(102,102,102,0.15)" },
  { type: "marginstephist", color: "rgba(102,102,102,0.8)" },
  { type: "margindensity", color: "#000000", linewidth: 1.5 },
  { type: "marginquantiletext" },
  { type: "marginquantilelines" },
];
const MULTI_SERIES_VIZ: CornerViz[] = [
  { type: "scatter", filtersigma: 2 },
  { type: "contour", sigmas: [2] },
  { type: "contourf", alpha: 0.6, sigmas: [1] },
  { type: "margindensity", linewidth: 2.5 },
  { type: "marginquantiletext" },
];
const MANY_SERIES_VIZ: CornerViz[] = [
  { type: "contour", sigmas: [1] },
  { type: "margindensity", linewidth: 2.5 },
];

const DEFAULT_SIGMAS = [0.5, 1, 1.5, 2];
const DEFAULT_QUANTILES: [number, number, number] = [0.16, 0.5, 0.84];

function pooledFinite(samples: Samples, variable: string): Float64Array {
  const chains = Array.from({ length: samples.nChains }, (_, c) => chainView(samples, variable, c));
  const values: number[] = [];
  for (const chain of chains) {
    for (const v of chain) if (Number.isFinite(v)) values.push(v);
  }
  return Float64Array.from(values);
}

function essOrN(samples: Samples, variable: string, n: number): number {
  const chains = Array.from({ length: samples.nChains }, (_, c) => chainView(samples, variable, c));
  const ess = essBulk(chains);
  return !Number.isFinite(ess) || ess <= 1 ? n : ess;
}

/** Type-7 quantile (Julia's default) over an unsorted sample. */
export function quantileT7(data: Float64Array, q: number): number {
  const sorted = Float64Array.from(data).sort();
  const n = sorted.length;
  if (n === 0) return Number.NaN;
  const h = (n - 1) * q;
  const lo = Math.floor(h);
  const hi = Math.min(lo + 1, n - 1);
  return (sorted[lo] as number) + (h - lo) * ((sorted[hi] as number) - (sorted[lo] as number));
}

/**
 * Silverman's rule of thumb with the effective sample size in place of N
 * (PairPlots' default_bandwidth_ess): 0.9 min(std, IQR/1.34) ess^(-1/5).
 */
export function bandwidthEss(data: Float64Array, ess: number, alpha = 0.9): number {
  if (data.length <= 1) return alpha;
  const n = data.length;
  let mean = 0;
  for (const v of data) mean += v;
  mean /= n;
  let ss = 0;
  for (const v of data) ss += (v - mean) * (v - mean);
  const varWidth = Math.sqrt(ss / (n - 1));
  const quantileWidth = (quantileT7(data, 0.75) - quantileT7(data, 0.25)) / 1.34;
  let width = Math.min(varWidth, quantileWidth);
  if (width === 0) width = varWidth === 0 ? 1 : varWidth;
  return alpha * width * ess ** -0.2;
}

/** PairPlots' ESS-driven default bin count: max(7, ceil(1.8 log2 ess) + 1). */
export function defaultBins(ess: number): number {
  return Math.max(7, Math.ceil(1.8 * Math.log2(ess)) + 1);
}

/** StatsBase.histrange: nice left-closed bin edges covering [lo, hi] with about n bins. */
export function histEdges(lo: number, hi: number, n: number): number[] {
  let start: number;
  let step: number;
  let divisor: number;
  let len: number;
  if (hi === lo) {
    start = hi;
    step = 1;
    divisor = 1;
    len = 1;
  } else {
    const bw = (hi - lo) / n;
    const lbw = Math.log10(bw);
    if (lbw >= 0) {
      step = 10 ** Math.floor(lbw);
      const r = bw / step;
      if (r <= 1.1) {
        // keep step
      } else if (r <= 2.2) step *= 2;
      else if (r <= 5.5) step *= 5;
      else step *= 10;
      divisor = 1;
      start = step * Math.floor(lo / step);
      len = Math.ceil((hi - start) / step);
    } else {
      divisor = 10 ** -Math.floor(lbw);
      const r = bw * divisor;
      if (r <= 1.1) {
        // keep divisor
      } else if (r <= 2.2) divisor /= 2;
      else if (r <= 5.5) divisor /= 5;
      else divisor /= 10;
      step = 1;
      start = Math.floor(lo * divisor);
      len = Math.ceil(hi * divisor - start);
    }
  }
  while (lo < start / divisor) start -= step;
  while ((start + (len - 1) * step) / divisor <= hi) len += 1;
  return Array.from({ length: len }, (_, i) => (start + i * step) / divisor);
}

/** Pdf-normalized histogram over histrange edges: bin centers plus weights. */
export function histPdf(data: Float64Array, nbins: number): { x: number[]; weights: number[] } {
  if (data.length === 0) return { x: [], weights: [] };
  let lo = Number.POSITIVE_INFINITY;
  let hi = Number.NEGATIVE_INFINITY;
  for (const v of data) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  const edges = histEdges(lo, hi, nbins);
  const bins = edges.length - 1;
  if (bins < 1) return { x: [], weights: [] };
  const counts = new Array<number>(bins).fill(0);
  const e0 = edges[0] as number;
  const stepInv = bins / ((edges[bins] as number) - e0);
  for (const v of data) {
    let i = Math.floor((v - e0) * stepInv);
    if (i < 0) i = 0;
    if (i >= bins) i = bins - 1;
    counts[i] = (counts[i] as number) + 1;
  }
  const width = ((edges[bins] as number) - e0) / bins;
  const norm = 1 / (data.length * width);
  return {
    x: Array.from({ length: bins }, (_, i) => (edges[i] as number) + width / 2),
    weights: counts.map((c) => c * norm),
  };
}

const INV_2PI = 1 / (2 * Math.PI);

/** Gaussian product-kernel 2-D KDE evaluated on an nx x ny grid. */
export function kde2d(
  xdat: Float64Array,
  ydat: Float64Array,
  xs: number[],
  ys: number[],
  hx: number,
  hy: number,
): number[][] {
  const nx = xs.length;
  const ny = ys.length;
  const h = Array.from({ length: nx }, () => new Array<number>(ny).fill(0));
  if (hx <= 0 || hy <= 0 || xdat.length === 0) return h;
  const norm = INV_2PI / (xdat.length * hx * hy);
  for (let i = 0; i < nx; i++) {
    const gx = xs[i] as number;
    const row = h[i] as number[];
    for (let j = 0; j < ny; j++) {
      const gy = ys[j] as number;
      let sum = 0;
      for (let k = 0; k < xdat.length; k++) {
        const zx = (gx - (xdat[k] as number)) / hx;
        const zy = (gy - (ydat[k] as number)) / hy;
        sum += Math.exp(-0.5 * (zx * zx + zy * zy));
      }
      row[j] = sum * norm;
    }
  }
  return h;
}

/**
 * PairPlots' sigma-to-density thresholds: mass fractions 1 - exp(-(1/2)(1/s)^2),
 * located by ascending cumulative sum over the KDE grid.
 */
export function contourThresholds(h: number[][], sigmas: number[]): number[] {
  const flat: number[] = [];
  for (const row of h) for (const v of row) flat.push(v);
  flat.sort((a, b) => a - b);
  let total = 0;
  for (const v of flat) total += v;
  if (total <= 0 || flat.length <= 1) return [];
  const levels = sigmas.map((s) => 1 - Math.exp(-0.5 * (1 / s) ** 2));
  let cum = 0;
  const cumsum = flat.map((v) => {
    cum += v;
    return cum / total;
  });
  const thresholds = levels.map((v0) => {
    let last = flat[0] as number;
    for (let i = 0; i < flat.length; i++) {
      if ((cumsum[i] as number) <= v0) last = flat[i] as number;
      else break;
    }
    return last;
  });
  return thresholds.sort((a, b) => a - b);
}

const key = (x: number, y: number): string => `${x.toFixed(9)},${y.toFixed(9)}`;

/**
 * Marching squares at threshold `level` over a grid padded with a zero border,
 * so every contour closes. Returns closed rings in data coordinates.
 */
export function marchingSquares(
  xs: number[],
  ys: number[],
  h: number[][],
  level: number,
): CornerRing[] {
  type Pt = [number, number];
  const segments: [Pt, Pt][] = [];
  const nx = xs.length;
  const ny = ys.length;
  const interp = (x1: number, y1: number, v1: number, x2: number, y2: number, v2: number): Pt => {
    const t = v2 === v1 ? 0.5 : (level - v1) / (v2 - v1);
    return [x1 + t * (x2 - x1), y1 + t * (y2 - y1)];
  };
  for (let i = 0; i < nx - 1; i++) {
    for (let j = 0; j < ny - 1; j++) {
      const x0 = xs[i] as number;
      const x1 = xs[i + 1] as number;
      const y0 = ys[j] as number;
      const y1 = ys[j + 1] as number;
      const a = (h[i] as number[])[j] as number;
      const b = (h[i + 1] as number[])[j] as number;
      const c = (h[i + 1] as number[])[j + 1] as number;
      const d = (h[i] as number[])[j + 1] as number;
      let idx = 0;
      if (a > level) idx |= 1;
      if (b > level) idx |= 2;
      if (c > level) idx |= 4;
      if (d > level) idx |= 8;
      if (idx === 0 || idx === 15) continue;
      const bottom = () => interp(x0, y0, a, x1, y0, b);
      const right = () => interp(x1, y0, b, x1, y1, c);
      const top = () => interp(x0, y1, d, x1, y1, c);
      const left = () => interp(x0, y0, a, x0, y1, d);
      switch (idx) {
        case 1:
          segments.push([left(), bottom()]);
          break;
        case 2:
          segments.push([bottom(), right()]);
          break;
        case 3:
          segments.push([left(), right()]);
          break;
        case 4:
          segments.push([right(), top()]);
          break;
        case 6:
          segments.push([bottom(), top()]);
          break;
        case 7:
          segments.push([left(), top()]);
          break;
        case 8:
          segments.push([top(), left()]);
          break;
        case 9:
          segments.push([top(), bottom()]);
          break;
        case 11:
          segments.push([top(), right()]);
          break;
        case 12:
          segments.push([right(), left()]);
          break;
        case 13:
          segments.push([right(), bottom()]);
          break;
        case 14:
          segments.push([bottom(), left()]);
          break;
        case 5: {
          const center = (a + b + c + d) / 4;
          if (center > level) {
            segments.push([left(), top()]);
            segments.push([right(), bottom()]);
          } else {
            segments.push([left(), bottom()]);
            segments.push([right(), top()]);
          }
          break;
        }
        case 10: {
          const center = (a + b + c + d) / 4;
          if (center > level) {
            segments.push([bottom(), right()]);
            segments.push([top(), left()]);
          } else {
            segments.push([bottom(), left()]);
            segments.push([top(), right()]);
          }
          break;
        }
        default:
          break;
      }
    }
  }

  const byStart = new Map<string, [Pt, Pt][]>();
  for (const seg of segments) {
    const k = key(seg[0][0], seg[0][1]);
    const list = byStart.get(k) ?? [];
    list.push(seg);
    byStart.set(k, list);
  }
  const rings: CornerRing[] = [];
  const used = new Set<[Pt, Pt]>();
  for (const seg of segments) {
    if (used.has(seg)) continue;
    const ringX: number[] = [seg[0][0]];
    const ringY: number[] = [seg[0][1]];
    let current = seg;
    used.add(current);
    for (;;) {
      const [, end] = current;
      ringX.push(end[0]);
      ringY.push(end[1]);
      const candidates = byStart.get(key(end[0], end[1])) ?? [];
      const next = candidates.find((s) => !used.has(s));
      if (!next) break;
      used.add(next);
      current = next;
    }
    if (ringX.length >= 4) rings.push({ x: ringX, y: ringY });
  }
  return rings;
}

function signedArea(ring: CornerRing): number {
  let area = 0;
  for (let i = 0; i < ring.x.length - 1; i++) {
    area +=
      (ring.x[i] as number) * (ring.y[i + 1] as number) -
      (ring.x[i + 1] as number) * (ring.y[i] as number);
  }
  return area / 2;
}

/** Even-odd ray cast, matching PairPlots' is_inside. */
export function pointInRing(x: number, y: number, ring: CornerRing): boolean {
  let inside = false;
  const n = ring.x.length;
  let j = n - 1;
  for (let i = 0; i < n; i++) {
    const xi = ring.x[i] as number;
    const yi = ring.y[i] as number;
    const xj = ring.x[j] as number;
    const yj = ring.y[j] as number;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
    j = i;
  }
  return inside;
}

/** Groups a level's rings into polygons: mutually-nested rings become outer plus holes. */
export function groupRings(rings: CornerRing[]): CornerPolygon[] {
  const remaining = new Set(rings.map((_, i) => i));
  const interact = (a: CornerRing, b: CornerRing): boolean =>
    pointInRing(a.x[0] as number, a.y[0] as number, b) ||
    pointInRing(b.x[0] as number, b.y[0] as number, a);
  const polygons: CornerPolygon[] = [];
  while (remaining.size > 0) {
    const start = remaining.values().next().value as number;
    const group: number[] = [];
    const toCheck = [start];
    remaining.delete(start);
    while (toCheck.length > 0) {
      const current = toCheck.pop() as number;
      group.push(current);
      for (const idx of [...remaining]) {
        if (interact(rings[current] as CornerRing, rings[idx] as CornerRing)) {
          toCheck.push(idx);
          remaining.delete(idx);
        }
      }
    }
    const areas = group.map((i) => Math.abs(signedArea(rings[i] as CornerRing)));
    let outerAt = 0;
    for (let i = 1; i < areas.length; i++) {
      if ((areas[i] as number) > (areas[outerAt] as number)) outerAt = i;
    }
    const outer = rings[group[outerAt] as number] as CornerRing;
    const holes = group
      .filter((_, i) => i !== outerAt)
      .map((i) => rings[i] as CornerRing)
      .filter((r) => pointInRing(r.x[0] as number, r.y[0] as number, outer));
    polygons.push({ rings: [outer, ...holes] });
  }
  return polygons;
}

interface ContourSet {
  thresholds: number[];
  levels: CornerRing[][];
}

/** KDE contours for one variable pair, on the zero-padded 100 x 100 grid. */
function prepContours(
  xdat: Float64Array,
  ydat: Float64Array,
  sigmas: number[],
  essX: number,
  essY: number,
  bandwidth: number,
): ContourSet {
  const [xlo, xhi] = minMax(xdat);
  const [ylo, yhi] = minMax(ydat);
  const xs = gridRange(xlo, xhi, GRID_N);
  const ys = gridRange(ylo, yhi, GRID_N);
  const hx = bandwidthEss(xdat, essX) * bandwidth;
  const hy = bandwidthEss(ydat, essY) * bandwidth;
  const h = kde2d(xdat, ydat, xs, ys, hx, hy);
  const thresholds = contourThresholds(h, sigmas);
  const stepX = xs.length > 1 ? (xs[1] as number) - (xs[0] as number) : 1;
  const stepY = ys.length > 1 ? (ys[1] as number) - (ys[0] as number) : 1;
  const padX = [(xs[0] as number) - stepX, ...xs, (xs[xs.length - 1] as number) + stepX];
  const padY = [(ys[0] as number) - stepY, ...ys, (ys[ys.length - 1] as number) + stepY];
  const padH: number[][] = Array.from({ length: padX.length }, () =>
    new Array<number>(padY.length).fill(0),
  );
  for (let i = 0; i < xs.length; i++) {
    for (let j = 0; j < ys.length; j++) {
      (padH[i + 1] as number[])[j + 1] = (h[i] as number[])[j] as number;
    }
  }
  const levels = thresholds.map((t) => marchingSquares(padX, padY, padH, t));
  return { thresholds, levels };
}

function minMax(data: Float64Array): [number, number] {
  let lo = Number.POSITIVE_INFINITY;
  let hi = Number.NEGATIVE_INFINITY;
  for (const v of data) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  return [lo, hi];
}

function gridRange(lo: number, hi: number, n: number): number[] {
  if (!(hi > lo)) return [lo];
  return Array.from({ length: n }, (_, i) => lo + ((hi - lo) * i) / (n - 1));
}

/** Keeps only points outside every ring of the outermost filter contour. */
export function filterScatter(
  xdat: Float64Array,
  ydat: Float64Array,
  rings: CornerRing[],
): { x: number[]; y: number[] } {
  const x: number[] = [];
  const y: number[] = [];
  for (let i = 0; i < xdat.length; i++) {
    const px = xdat[i] as number;
    const py = ydat[i] as number;
    let outside = true;
    for (const ring of rings) {
      if (pointInRing(px, py, ring)) {
        outside = false;
        break;
      }
    }
    if (outside) {
      x.push(px);
      y.push(py);
    }
  }
  return { x, y };
}

const roundTo = (v: number, digits: number): number => Number(v.toFixed(digits));

/**
 * PairPlots' margin title: median with asymmetric quantile errors, switching to
 * scientific notation when the errors need more than four decimal digits.
 */
export function marginTitle(low: number, mid: number, high: number): string {
  const largest = Math.max(Math.abs(high), Math.abs(low));
  if (largest === 0) {
    const digits = mid === 0 ? 0 : Math.max(0, 1 - Math.round(Math.log10(Math.abs(mid))));
    return mid.toFixed(digits);
  }
  const digits = Math.max(0, 1 - Math.round(Math.log10(largest)));
  if (digits > 4) {
    const k = digits - 1;
    const scale = 10 ** k;
    if (roundTo(low, digits) === roundTo(high, digits)) {
      return `(${(mid * scale).toFixed(1)} ± ${(high * scale).toFixed(1)}) × 10^-${k}`;
    }
    return `(${(mid * scale).toFixed(1)} -${(low * scale).toFixed(1)}/+${(high * scale).toFixed(1)}) × 10^-${k}`;
  }
  if (roundTo(low, digits) === roundTo(high, digits)) {
    return `${mid.toFixed(digits)} ± ${high.toFixed(digits)}`;
  }
  return `${mid.toFixed(digits)} -${low.toFixed(digits)}/+${high.toFixed(digits)}`;
}

interface HexBinResult {
  cx: number[];
  cy: number[];
  weight: number[];
  wmax: number;
  hexX: number;
  hexY: number;
}

/** Makie's hexbin: staggered-row nearest-center assignment over nbins per axis. */
export function hexbin(
  xdat: Float64Array,
  ydat: Float64Array,
  xbins: number,
  ybins: number,
): HexBinResult {
  const [xlo, xhi] = minMax(xdat);
  const [ylo, yhi] = minMax(ydat);
  const spacingX = (xhi - xlo) / Math.max(1, xbins - 1) || 1;
  const spacingY = (yhi - ylo) / Math.max(1, ybins - 1) || 1;
  const sizeX = spacingX * 2;
  const sizeY = spacingY * (4 / 3);
  const yweight = sizeX / sizeY;
  const counts = new Map<string, { ix: number; iy: number; n: number }>();
  for (let i = 0; i < xdat.length; i++) {
    const tx = xdat[i] as number;
    const ty = ydat[i] as number;
    const dvx = Math.floor((tx - xlo) / spacingX);
    const dvy = Math.floor((ty - ylo) / spacingY);
    const nx = xlo + spacingX * (dvx + (dvx % 2 !== 0 ? 1 : 0));
    const ny = ylo + spacingY * (dvy + (dvy % 2 !== 0 ? 1 : 0));
    const nxs = xlo + spacingX * (dvx + (dvx % 2 === 0 ? 1 : 0));
    const nys = ylo + spacingY * (dvy + (dvy % 2 === 0 ? 1 : 0));
    const d1 = (tx - nx) ** 2 + (yweight * (ty - ny)) ** 2;
    const d2 = (tx - nxs) ** 2 + (yweight * (ty - nys)) ** 2;
    let ix: number;
    let iy: number;
    if (d1 < d2) {
      ix = Math.ceil(dvx / 2);
      iy = dvy % 2 === 0 ? dvy : dvy + 1;
    } else {
      ix = Math.floor(dvx / 2);
      iy = dvy % 2 === 0 ? dvy + 1 : dvy;
    }
    const k = `${ix},${iy}`;
    const entry = counts.get(k);
    if (entry) entry.n += 1;
    else counts.set(k, { ix, iy, n: 1 });
  }
  const cx: number[] = [];
  const cy: number[] = [];
  const weight: number[] = [];
  let wmax = 0;
  for (const { ix, iy, n } of counts.values()) {
    cx.push(xlo + (2 * ix + (Math.abs(iy) % 2)) * spacingX);
    cy.push(ylo + iy * spacingY);
    weight.push(n);
    if (n > wmax) wmax = n;
  }
  return { cx, cy, weight, wmax, hexX: spacingX, hexY: (2 / 3) * spacingY };
}

/** 2-D histogram over histrange edges (bin centers plus a weight matrix). */
export function hist2d(
  xdat: Float64Array,
  ydat: Float64Array,
  xbins: number,
  ybins: number,
): { x: number[]; y: number[]; weights: number[][]; wmax: number } {
  const [xlo, xhi] = minMax(xdat);
  const [ylo, yhi] = minMax(ydat);
  const ex = histEdges(xlo, xhi, xbins);
  const ey = histEdges(ylo, yhi, ybins);
  const nx = ex.length - 1;
  const ny = ey.length - 1;
  if (nx < 1 || ny < 1) return { x: [], y: [], weights: [], wmax: 0 };
  const weights = Array.from({ length: nx }, () => new Array<number>(ny).fill(0));
  const ex0 = ex[0] as number;
  const ey0 = ey[0] as number;
  const sx = nx / ((ex[nx] as number) - ex0);
  const sy = ny / ((ey[ny] as number) - ey0);
  let wmax = 0;
  for (let k = 0; k < xdat.length; k++) {
    let i = Math.floor(((xdat[k] as number) - ex0) * sx);
    let j = Math.floor(((ydat[k] as number) - ey0) * sy);
    if (i < 0) i = 0;
    if (i >= nx) i = nx - 1;
    if (j < 0) j = 0;
    if (j >= ny) j = ny - 1;
    const w = ((weights[i] as number[])[j] as number) + 1;
    (weights[i] as number[])[j] = w;
    if (w > wmax) wmax = w;
  }
  const cx = Array.from(
    { length: nx },
    (_, i) => (ex[i] as number) + ((ex[i + 1] as number) - (ex[i] as number)) / 2,
  );
  const cy = Array.from(
    { length: ny },
    (_, j) => (ey[j] as number) + ((ey[j + 1] as number) - (ey[j] as number)) / 2,
  );
  return { x: cx, y: cy, weights, wmax };
}

function truthValues(truth: CornerTruth, variable: string): number[] {
  const v = truth.values[variable];
  if (v === undefined) return [];
  return Array.isArray(v) ? v : [v];
}

/**
 * Builds the corner-plot grid for one or more sample series, PairPlots-style:
 * omitted viz stacks fall back to the tier for the series count, and every
 * variable's axis domain is linked across series, truths, and bands.
 */
export function cornerData(seriesIn: CornerSeries[], opts: CornerOptions = {}): CornerData {
  if (seriesIn.length === 0) throw new Error("cornerData needs at least one series");
  const tier =
    seriesIn.length === 1
      ? SINGLE_SERIES_VIZ
      : seriesIn.length <= 5
        ? MULTI_SERIES_VIZ
        : MANY_SERIES_VIZ;
  const series = seriesIn.map((s, i) => ({
    ...s,
    color: s.color ?? (seriesIn.length === 1 ? SINGLE_SERIES_COLOR : wongColor(i)),
    viz: s.viz ?? tier,
  }));

  const vars = opts.vars ?? [...new Set(series.flatMap((s) => [...s.samples.variables]))];
  if (vars.length === 0) throw new Error("cornerData found no variables to plot");
  const labels = vars.map((v) => opts.labels?.[v] ?? v);
  const truths = opts.truth ?? [];
  const bands = opts.band ?? [];

  const pooled = new Map<string, Float64Array[]>();
  const ess = new Map<string, number[]>();
  for (const v of vars) {
    const perSeries = series.map((s) =>
      s.samples.variables.includes(v) ? pooledFinite(s.samples, v) : new Float64Array(0),
    );
    pooled.set(v, perSeries);
    ess.set(
      v,
      perSeries.map((data, i) =>
        data.length > 0
          ? essOrN((series[i] as (typeof series)[number]).samples, v, data.length)
          : 0,
      ),
    );
  }

  const domains: [number, number][] = vars.map((v) => {
    let lo = Number.POSITIVE_INFINITY;
    let hi = Number.NEGATIVE_INFINITY;
    for (const data of pooled.get(v) as Float64Array[]) {
      for (const value of data) {
        if (value < lo) lo = value;
        if (value > hi) hi = value;
      }
    }
    for (const t of truths) {
      for (const value of truthValues(t, v)) {
        if (value < lo) lo = value;
        if (value > hi) hi = value;
      }
    }
    for (const b of bands) {
      const r = b.ranges[v];
      if (r) {
        if (r[0] < lo) lo = r[0];
        if (r[1] > hi) hi = r[1];
      }
    }
    if (!(hi > lo)) {
      lo -= 1;
      hi += 1;
    }
    return [lo, hi];
  });

  // Per-variable series bins win over the layer override, like PairPlots.
  const binsFor = (si: number, v: string, override?: number): number => {
    const s = series[si] as (typeof series)[number];
    if (s.bins?.[v] !== undefined) return s.bins[v] as number;
    if (override !== undefined) return override;
    return defaultBins((ess.get(v) as number[])[si] as number);
  };

  const diagonal =
    series.some((s) => s.viz.some((l) => l.type.startsWith("margin"))) ||
    truths.length > 0 ||
    bands.length > 0;

  const diags: CornerDiagCell[] = vars.map((v, vi) => {
    const layers: CornerDiagLayer[] = [];
    const titles: CornerTitle[] = [];
    series.forEach((s, si) => {
      const data = (pooled.get(v) as Float64Array[])[si] as Float64Array;
      if (data.length === 0) return;
      const seriesEss = (ess.get(v) as number[])[si] as number;
      for (const layer of s.viz) {
        switch (layer.type) {
          case "marginhist": {
            const { x, weights } = histPdf(data, binsFor(si, v, layer.bins));
            layers.push({
              type: "marginhist",
              seriesIndex: si,
              color: layer.color ?? s.color,
              x,
              weights,
            });
            break;
          }
          case "marginstephist": {
            const { x, weights } = histPdf(data, binsFor(si, v, layer.bins));
            layers.push({
              type: "marginstephist",
              seriesIndex: si,
              color: layer.color ?? s.color,
              x,
              weights,
            });
            break;
          }
          case "margindensity": {
            const [lo, hi] = minMax(data);
            const xs = gridRange(lo, hi, DENSITY_N);
            const h = bandwidthEss(data, seriesEss) * (layer.bandwidth ?? 1);
            const ys = kde1d(data, xs, h);
            layers.push({
              type: "margindensity",
              seriesIndex: si,
              color: layer.color ?? s.color,
              linewidth: layer.linewidth ?? 1.5,
              x: xs,
              y: ys,
            });
            break;
          }
          case "marginquantiletext": {
            const q = layer.quantiles ?? DEFAULT_QUANTILES;
            const mid = quantileT7(data, q[1]);
            const low = mid - quantileT7(data, q[0]);
            const high = quantileT7(data, q[2]) - mid;
            titles.push({
              seriesIndex: si,
              color: s.color,
              text: marginTitle(low, mid, high),
              low,
              mid,
              high,
            });
            break;
          }
          case "marginquantilelines": {
            const q = layer.quantiles ?? DEFAULT_QUANTILES;
            layers.push({
              type: "marginquantilelines",
              seriesIndex: si,
              color: s.color,
              values: [quantileT7(data, q[0]), quantileT7(data, q[1]), quantileT7(data, q[2])],
            });
            break;
          }
          default:
            break;
        }
      }
    });
    truths.forEach((t, ti) => {
      const values = truthValues(t, v);
      if (values.length === 0) return;
      layers.push({
        type: "marginlines",
        seriesIndex: series.length + ti,
        color: t.color ?? "#333333",
        values,
      });
      titles.push({
        seriesIndex: series.length + ti,
        color: t.color ?? "#333333",
        text: [...new Set(values)].map((value) => marginTitle(0, value, 0)).join(", "),
        low: 0,
        mid: values[0] as number,
        high: 0,
      });
    });
    bands.forEach((b, bi) => {
      const r = b.ranges[v];
      if (!r) return;
      layers.push({
        type: "marginbands",
        seriesIndex: series.length + truths.length + bi,
        color: b.color ?? "#333333",
        alpha: b.alpha ?? 0.4,
        ranges: [r],
      });
    });
    return { index: vi, layers, titles };
  });

  const cells: CornerCell[] = [];
  for (let row = 1; row < vars.length; row++) {
    for (let col = 0; col < row; col++) {
      const xVar = vars[col] as string;
      const yVar = vars[row] as string;
      const layers: CornerBodyLayer[] = [];
      series.forEach((s, si) => {
        const xdat = (pooled.get(xVar) as Float64Array[])[si] as Float64Array;
        const ydat = (pooled.get(yVar) as Float64Array[])[si] as Float64Array;
        if (xdat.length === 0 || ydat.length === 0) return;
        const essX = (ess.get(xVar) as number[])[si] as number;
        const essY = (ess.get(yVar) as number[])[si] as number;
        for (const layer of s.viz) {
          switch (layer.type) {
            case "hexbin": {
              const xbins = binsFor(si, xVar, layer.bins);
              const ybins = binsFor(si, yVar, layer.bins);
              const bin = hexbin(xdat, ydat, xbins, ybins);
              layers.push({
                type: "hexbin",
                seriesIndex: si,
                color: layer.color ?? s.color,
                ...bin,
              });
              break;
            }
            case "hist2d": {
              const xbins = binsFor(si, xVar, layer.bins);
              const ybins = binsFor(si, yVar, layer.bins);
              const grid = hist2d(xdat, ydat, xbins, ybins);
              layers.push({
                type: "hist2d",
                seriesIndex: si,
                color: layer.color ?? s.color,
                ...grid,
              });
              break;
            }
            case "contour": {
              const { levels } = prepContours(
                xdat,
                ydat,
                layer.sigmas ?? DEFAULT_SIGMAS,
                essX,
                essY,
                layer.bandwidth ?? 1,
              );
              layers.push({
                type: "contour",
                seriesIndex: si,
                color: layer.color ?? s.color,
                linewidth: layer.linewidth ?? 1.5,
                curves: levels.flat(),
              });
              break;
            }
            case "contourf": {
              const { levels } = prepContours(
                xdat,
                ydat,
                layer.sigmas ?? DEFAULT_SIGMAS,
                essX,
                essY,
                layer.bandwidth ?? 1,
              );
              layers.push({
                type: "contourf",
                seriesIndex: si,
                color: layer.color ?? s.color,
                alpha: layer.alpha ?? 1,
                polygons: levels.flatMap((rings) => groupRings(rings)),
              });
              break;
            }
            case "scatter": {
              let x: number[];
              let y: number[];
              if (layer.filtersigma !== undefined) {
                const { levels } = prepContours(xdat, ydat, [layer.filtersigma], essX, essY, 1);
                ({ x, y } = filterScatter(xdat, ydat, (levels[0] ?? []) as CornerRing[]));
              } else {
                x = [...xdat];
                y = [...ydat];
              }
              layers.push({
                type: "scatter",
                seriesIndex: si,
                color: layer.color ?? s.color,
                markersize: layer.markersize ?? 1,
                x,
                y,
              });
              break;
            }
            case "trendline": {
              const fit = leastSquares(xdat, ydat);
              if (fit) {
                layers.push({
                  type: "trendline",
                  seriesIndex: si,
                  color: layer.color ?? "#cc0000",
                  m: fit.m,
                  b: fit.b,
                });
              }
              break;
            }
            case "correlation": {
              layers.push({
                type: "correlation",
                seriesIndex: si,
                value: pearsonOf(xdat, ydat),
                digits: layer.digits ?? 3,
                position: layer.position ?? [0.01, 1],
              });
              break;
            }
            default:
              break;
          }
        }
      });
      truths.forEach((t, ti) => {
        const xs = truthValues(t, xVar);
        const ys = truthValues(t, yVar);
        if (xs.length === 0 && ys.length === 0) return;
        layers.push({
          type: "bodylines",
          seriesIndex: series.length + ti,
          color: t.color ?? "#333333",
          xs,
          ys,
        });
      });
      bands.forEach((b, bi) => {
        const rx = b.ranges[xVar];
        const ry = b.ranges[yVar];
        if (!rx && !ry) return;
        layers.push({
          type: "bodybands",
          seriesIndex: series.length + truths.length + bi,
          color: b.color ?? "#333333",
          alpha: b.alpha ?? 0.4,
          x: rx ? [rx] : [],
          y: ry ? [ry] : [],
        });
      });
      cells.push({ row, col, layers });
    }
  }

  return {
    kind: "corner",
    vars,
    labels,
    domains,
    series: series.map((s) => ({
      ...(s.label !== undefined ? { label: s.label } : {}),
      color: s.color,
    })),
    diagonal,
    fullgrid: opts.fullgrid ?? false,
    cells,
    diags,
  };
}

function kde1d(data: Float64Array, grid: number[], h: number): number[] {
  if (h <= 0 || data.length === 0) return new Array<number>(grid.length).fill(0);
  const norm = 1 / (data.length * h * Math.sqrt(2 * Math.PI));
  return grid.map((g) => {
    let sum = 0;
    for (const v of data) {
      const z = (g - v) / h;
      sum += Math.exp(-0.5 * z * z);
    }
    return sum * norm;
  });
}

function leastSquares(x: Float64Array, y: Float64Array): { m: number; b: number } | null {
  const n = x.length;
  if (n === 0) return null;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    const xi = x[i] as number;
    const yi = y[i] as number;
    sx += xi;
    sy += yi;
    sxx += xi * xi;
    sxy += xi * yi;
  }
  const det = n * sxx - sx * sx;
  if (det === 0) return null;
  return { m: (n * sxy - sx * sy) / det, b: (sxx * sy - sx * sxy) / det };
}

function pearsonOf(x: Float64Array, y: Float64Array): number {
  const n = Math.min(x.length, y.length);
  if (n < 2) return Number.NaN;
  let mx = 0;
  let my = 0;
  for (let i = 0; i < n; i++) {
    mx += x[i] as number;
    my += y[i] as number;
  }
  mx /= n;
  my /= n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = (x[i] as number) - mx;
    const dy = (y[i] as number) - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  return sxy / Math.sqrt(sxx * syy);
}
