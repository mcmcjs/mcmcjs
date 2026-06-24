import {
  extent,
  niceDomain,
  seriesColor,
  svgCircle,
  svgFrame,
  svgLine,
  svgPolyline,
  svgRect,
} from "@mcmcjs/charts";
import type {
  AutocorrData,
  DensityData,
  ForestData,
  HistogramData,
  RankData,
  SvgOptions,
  TraceData,
} from "./types";

const W = 640;
const H = 220;

/** Trace plot: one line per chain over iteration. */
export function renderTraceSVG(data: TraceData, opts: SvgOptions = {}): string {
  const [rmin, rmax] = extent(data.chains.flat());
  const [ymin, ymax] = niceDomain(rmin, rmax);
  const rhat = Number.isFinite(data.rhat) ? data.rhat.toFixed(3) : "n/a";
  const ess = Number.isFinite(data.essBulk) ? String(Math.round(data.essBulk)) : "n/a";
  const frame = svgFrame({
    width: opts.width ?? W,
    height: opts.height ?? H,
    xDomain: [0, Math.max(1, data.nDraws - 1)],
    yDomain: [ymin, ymax],
    title: `${data.variable}  (R-hat ${rhat}, ESS ${ess})`,
    xLabel: "iteration",
  });
  const content = data.chains
    .map((vals, chain) =>
      svgPolyline(
        vals.map((v, i) => [frame.x.map(i), frame.y.map(v)] as [number, number]),
        seriesColor(chain),
      ),
    )
    .join("");
  return frame.render(content);
}

/** Density plot: one KDE curve per chain. */
export function renderDensitySVG(data: DensityData, opts: SvgOptions = {}): string {
  const xLo = data.x[0] ?? 0;
  const xHi = data.x[data.x.length - 1] ?? 1;
  let maxY = 0;
  for (const curve of data.chains) for (const v of curve) if (v > maxY) maxY = v;
  const frame = svgFrame({
    width: opts.width ?? W,
    height: opts.height ?? H,
    xDomain: [xLo, xHi],
    yDomain: [0, maxY || 1],
    title: `${data.variable}  density`,
    xLabel: data.variable,
    yLabel: "density",
  });
  const content = data.chains
    .map((curve, chain) =>
      svgPolyline(
        curve.map((v, k) => [frame.x.map(data.x[k] ?? 0), frame.y.map(v)] as [number, number]),
        seriesColor(chain),
      ),
    )
    .join("");
  return frame.render(content);
}

/** Histogram: filled bars over pooled bins. */
export function renderHistogramSVG(data: HistogramData, opts: SvgOptions = {}): string {
  const edges = data.binEdges;
  const lo = edges[0] ?? 0;
  const hi = edges[edges.length - 1] ?? 1;
  const maxC = Math.max(1, ...data.counts);
  const frame = svgFrame({
    width: opts.width ?? W,
    height: opts.height ?? H,
    xDomain: [lo, hi],
    yDomain: [0, maxC],
    title: `${data.variable}  histogram (${data.counts.length} bins)`,
    xLabel: data.variable,
    yLabel: "count",
  });
  const content = data.counts
    .map((c, b) => {
      const x0 = frame.x.map(edges[b] ?? lo);
      const x1 = frame.x.map(edges[b + 1] ?? hi);
      const yTop = frame.y.map(c);
      return svgRect(x0 + 0.5, yTop, x1 - x0 - 1, frame.area.bottom - yTop, seriesColor(0));
    })
    .join("");
  return frame.render(content);
}

/** Autocorrelation: one decaying line per chain over lag, with a zero reference line. */
export function renderAutocorrSVG(data: AutocorrData, opts: SvgOptions = {}): string {
  let yMin = 0;
  for (const acf of data.chains) for (const v of acf) if (v < yMin) yMin = v;
  const frame = svgFrame({
    width: opts.width ?? W,
    height: opts.height ?? H,
    xDomain: [0, Math.max(1, data.maxLag)],
    yDomain: [yMin, 1],
    title: `${data.variable}  autocorrelation`,
    xLabel: "lag",
    yLabel: "acf",
  });
  const zero = svgLine(frame.area.left, frame.y.map(0), frame.area.right, frame.y.map(0), "#bbb");
  const content = data.chains
    .map((acf, chain) =>
      svgPolyline(
        acf.map((v, k) => [frame.x.map(k), frame.y.map(v)] as [number, number]),
        seriesColor(chain),
      ),
    )
    .join("");
  return frame.render(zero + content);
}

/** Rank plot: a stepped count outline per chain over rank bins, with a uniform reference. */
export function renderRankSVG(data: RankData, opts: SvgOptions = {}): string {
  const bins = data.bins;
  const maxC = Math.max(1, ...data.counts.flat());
  const frame = svgFrame({
    width: opts.width ?? W,
    height: opts.height ?? H,
    xDomain: [0, bins],
    yDomain: [0, maxC],
    title: `${data.variable}  rank (${bins} bins, ${data.nChains} chains)`,
    xLabel: "rank bin",
    yLabel: "count",
  });
  const expected = svgLine(
    frame.area.left,
    frame.y.map(data.expected),
    frame.area.right,
    frame.y.map(data.expected),
    "#bbb",
  );
  const content = data.counts
    .map((counts, chain) => {
      const pts: [number, number][] = [];
      counts.forEach((c, b) => {
        pts.push([frame.x.map(b), frame.y.map(c)]);
        pts.push([frame.x.map(b + 1), frame.y.map(c)]);
      });
      return svgPolyline(pts, seriesColor(chain));
    })
    .join("");
  return frame.render(expected + content);
}

/** Forest plot: a point estimate, HDI, and IQR row per variable on a shared x-axis. */
export function renderForestSVG(data: ForestData, opts: SvgOptions = {}): string {
  const rows = data.rows;
  if (rows.length === 0)
    return svgFrame({
      width: opts.width ?? W,
      height: 80,
      xDomain: [0, 1],
      yDomain: [0, 1],
    }).render("");

  let xmin = Number.POSITIVE_INFINITY;
  let xmax = Number.NEGATIVE_INFINITY;
  for (const r of rows) {
    xmin = Math.min(xmin, r.hdi[0], r.iqr[0]);
    xmax = Math.max(xmax, r.hdi[1], r.iqr[1]);
  }
  const [lo, hi] = niceDomain(xmin, xmax);
  const height = opts.height ?? Math.max(120, 48 + rows.length * 26);
  const frame = svgFrame({
    width: opts.width ?? W,
    height,
    xDomain: [lo, hi],
    yDomain: [rows.length, 0], // row 0 at the top
    title: `forest  (${Math.round(data.hdiProb * 100)}% HDI)`,
    yLabels: rows.map((r) => r.variable),
  });
  const content = rows
    .map((r, i) => {
      const yc = frame.y.map(i + 0.5);
      const col = r.converged ? "#2ca02c" : "#d62728";
      return [
        svgLine(frame.x.map(r.hdi[0]), yc, frame.x.map(r.hdi[1]), yc, col, 1),
        svgLine(frame.x.map(r.iqr[0]), yc, frame.x.map(r.iqr[1]), yc, col, 4),
        svgCircle(frame.x.map(r.mean), yc, 3, "#111"),
      ].join("");
    })
    .join("");
  return frame.render(content);
}
