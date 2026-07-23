import {
  extent,
  fmtNum,
  niceDomain,
  polygonPathD,
  seriesColor,
  svgCircle,
  svgFrame,
  svgLine,
  svgPath,
  svgPolyline,
  svgRect,
  viridisHex,
} from "@mcmcjs/charts";
import type { CornerBodyLayer, CornerData } from "./corner";
import type {
  AutocorrData,
  ChainIntervalsAllData,
  ChainIntervalsData,
  CumulativeMeanData,
  DensityData,
  DiagnosticsHeatmapData,
  EcdfData,
  EnergyData,
  ForestData,
  HistogramData,
  IntervalRow,
  PairData,
  ParallelCoordsData,
  RankData,
  RunningRhatData,
  SplomData,
  SummaryTableData,
  SvgOptions,
  TraceData,
  ViolinData,
} from "./types";

const W = 640;
const H = 220;

const FONT = "12px ui-monospace, SFMono-Regular, Menlo, monospace";

function escText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

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
        1.25,
        `chain ${chain + 1}`,
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
        1.25,
        `chain ${chain + 1}`,
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
      return svgRect(
        x0 + 0.5,
        yTop,
        x1 - x0 - 1,
        frame.area.bottom - yTop,
        seriesColor(0),
        `[${fmtNum(edges[b] ?? lo)}, ${fmtNum(edges[b + 1] ?? hi)}): ${c}`,
      );
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
  const zero = svgLine(
    frame.area.left,
    frame.y.map(0),
    frame.area.right,
    frame.y.map(0),
    "var(--mcmc-grid,#bbb)",
  );
  const content = data.chains
    .map((acf, chain) =>
      svgPolyline(
        acf.map((v, k) => [frame.x.map(k), frame.y.map(v)] as [number, number]),
        seriesColor(chain),
        1.25,
        `chain ${chain + 1}`,
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
    "var(--mcmc-grid,#bbb)",
  );
  const content = data.counts
    .map((counts, chain) => {
      const pts: [number, number][] = [];
      counts.forEach((c, b) => {
        pts.push([frame.x.map(b), frame.y.map(c)]);
        pts.push([frame.x.map(b + 1), frame.y.map(c)]);
      });
      return svgPolyline(pts, seriesColor(chain), 1.25, `chain ${chain + 1}`);
    })
    .join("");
  return frame.render(expected + content);
}

/** Energy diagnostic: marginal vs transition energy as two overlaid curves. */
export function renderEnergySVG(data: EnergyData, opts: SvgOptions = {}): string {
  const centers = data.marginal.map(
    (_, b) => ((data.edges[b] ?? 0) + (data.edges[b + 1] ?? 0)) / 2,
  );
  const maxC = Math.max(1, ...data.marginal, ...data.transition);
  const finite = data.bfmi.filter(Number.isFinite);
  const bfmi = finite.length ? finite.reduce((a, b) => a + b, 0) / finite.length : Number.NaN;
  const frame = svgFrame({
    width: opts.width ?? W,
    height: opts.height ?? H,
    xDomain: [centers[0] ?? 0, centers[centers.length - 1] ?? 1],
    yDomain: [0, maxC],
    title: `energy  (E-BFMI ${Number.isFinite(bfmi) ? bfmi.toFixed(2) : "n/a"})`,
    xLabel: "energy (centered)",
    yLabel: "count",
  });
  const curve = (counts: number[], series: number, label: string): string =>
    svgPolyline(
      counts.map((c, b) => [frame.x.map(centers[b] ?? 0), frame.y.map(c)] as [number, number]),
      seriesColor(series),
      1.25,
      label,
    );
  return frame.render(
    curve(data.marginal, 0, "marginal") + curve(data.transition, 1, "transition"),
  );
}

/** A horizontal viridis gradient legend bar with min/max labels and a caption. */
function viridisLegend(
  frame: ReturnType<typeof svgFrame>,
  label: string,
  lo: number,
  hi: number,
): string {
  const segments = 32;
  const barW = Math.min(160, frame.area.right - frame.area.left - 8);
  const barH = 8;
  const x0 = frame.area.right - barW;
  const y0 = frame.area.top + 2;
  const segW = barW / segments;
  const parts: string[] = [];
  for (let s = 0; s < segments; s++) {
    const t = segments > 1 ? s / (segments - 1) : 0;
    parts.push(svgRect(x0 + s * segW, y0, segW + 0.5, barH, viridisHex(t)));
  }
  parts.push(
    `<text x="${x0.toFixed(2)}" y="${(y0 + barH + 11).toFixed(2)}" text-anchor="start" fill="var(--mcmc-fg,#333)">${escText(fmtNum(lo))}</text>`,
  );
  parts.push(
    `<text x="${(x0 + barW).toFixed(2)}" y="${(y0 + barH + 11).toFixed(2)}" text-anchor="end" fill="var(--mcmc-fg,#333)">${escText(fmtNum(hi))}</text>`,
  );
  parts.push(
    `<text x="${(x0 + barW / 2).toFixed(2)}" y="${(y0 - 3).toFixed(2)}" text-anchor="middle" fill="var(--mcmc-fg,#333)">color: ${escText(label)}</text>`,
  );
  return parts.join("");
}

/**
 * Pair (joint) scatter of two variables. Points are colored by chain, or, when the
 * data carries a `color` channel, shaded through the viridis colormap with a gradient
 * legend. Divergences are always drawn on top in red.
 */
export function renderPairSVG(data: PairData, opts: SvgOptions = {}): string {
  const [xmin, xmax] = niceDomain(...extent(data.x));
  const [ymin, ymax] = niceDomain(...extent(data.y));
  const frame = svgFrame({
    width: opts.width ?? 480,
    height: opts.height ?? 420,
    xDomain: [xmin, xmax],
    yDomain: [ymin, ymax],
    title: `${data.xVar} vs ${data.yVar}`,
    xLabel: data.xVar,
    yLabel: data.yVar,
  });

  // Keep every divergence; thin the rest so a long run stays a reasonable file.
  const cap = 3000;
  const normalIdx: number[] = [];
  const divergentIdx: number[] = [];
  for (let i = 0; i < data.x.length; i++) (data.diverging[i] ? divergentIdx : normalIdx).push(i);
  const step = Math.max(1, Math.ceil(normalIdx.length / cap));

  const color = data.color;
  const colorMin = data.colorMin ?? 0;
  const colorMax = data.colorMax ?? 1;
  const span = Math.max(colorMax - colorMin, 1e-9);
  const fillFor = (i: number): string => {
    if (!color) return seriesColor(data.chain[i] ?? 0);
    const cv = color[i] ?? colorMin;
    const t = (cv - colorMin) / span;
    return viridisHex(t < 0 ? 0 : t > 1 ? 1 : t);
  };

  const tipFor = (i: number, divergent: boolean): string => {
    const base = `${data.xVar} ${fmtNum(data.x[i] ?? 0)}, ${data.yVar} ${fmtNum(data.y[i] ?? 0)} · chain ${(data.chain[i] ?? 0) + 1}`;
    const shade = color && data.colorVar ? ` · ${data.colorVar} ${fmtNum(color[i] ?? 0)}` : "";
    return `${base}${shade}${divergent ? " · divergent" : ""}`;
  };
  const dot = (i: number, r: number, fill: string, divergent: boolean): string =>
    svgCircle(
      frame.x.map(data.x[i] ?? 0),
      frame.y.map(data.y[i] ?? 0),
      r,
      fill,
      tipFor(i, divergent),
    );
  const normal = normalIdx
    .filter((_, k) => k % step === 0)
    .map((i) => dot(i, 1.4, fillFor(i), false))
    .join("");
  const divergent = divergentIdx.map((i) => dot(i, 2.5, "#d62728", true)).join("");
  const legend =
    color && data.colorVar ? viridisLegend(frame, data.colorVar, colorMin, colorMax) : "";
  return frame.render(normal + divergent + legend);
}

/** Empirical CDF: one monotone step curve per chain on a fixed [0,1] y-axis. */
export function renderEcdfSVG(data: EcdfData, opts: SvgOptions = {}): string {
  const [xmin, xmax] = niceDomain(...extent(data.series.flatMap((s) => s.x)));
  const frame = svgFrame({
    width: opts.width ?? W,
    height: opts.height ?? H,
    xDomain: [xmin, xmax],
    yDomain: [0, 1],
    title: `${data.variable}  ECDF`,
    xLabel: data.variable,
    yLabel: "P",
  });
  const content = data.series
    .map((s, chain) =>
      svgPolyline(
        s.x.map((xv, i) => [frame.x.map(xv), frame.y.map(s.y[i] ?? 0)] as [number, number]),
        seriesColor(chain),
        1.25,
        `chain ${chain + 1}`,
      ),
    )
    .join("");
  return frame.render(content);
}

/** Cumulative-mean: one running-mean line per chain over iteration. */
export function renderCumulativeMeanSVG(data: CumulativeMeanData, opts: SvgOptions = {}): string {
  const [rmin, rmax] = extent(data.chains.flat());
  const [ymin, ymax] = niceDomain(rmin, rmax);
  const maxLen = data.iterations.length;
  const frame = svgFrame({
    width: opts.width ?? W,
    height: opts.height ?? H,
    xDomain: [1, Math.max(2, maxLen)],
    yDomain: [ymin, ymax],
    title: `${data.variable}  cumulative mean`,
    xLabel: "iteration",
    yLabel: `mean (${data.variable})`,
  });
  const content = data.chains
    .map((vals, chain) =>
      svgPolyline(
        vals.map((v, i) => [frame.x.map(i + 1), frame.y.map(v)] as [number, number]),
        seriesColor(chain),
        1.25,
        `chain ${chain + 1}`,
      ),
    )
    .join("");
  return frame.render(content);
}

/** Running basic R-hat: a single line with 1.00 and 1.05 reference lines. */
export function renderRunningRhatSVG(data: RunningRhatData, opts: SvgOptions = {}): string {
  const width = opts.width ?? W;
  const height = opts.height ?? H;
  if (data.iterations.length === 0) {
    return svgFrame({
      width,
      height: 80,
      xDomain: [0, 1],
      yDomain: [0, 1],
      title: `${data.variable}  running R-hat (needs >= 2 chains)`,
    }).render("");
  }
  const [rmin, rmax] = extent([...data.rhat, 1, 1.05]);
  const [ymin, ymax] = niceDomain(rmin, rmax);
  const xLo = data.iterations[0] ?? 0;
  const xHi = data.iterations[data.iterations.length - 1] ?? 1;
  const frame = svgFrame({
    width,
    height,
    xDomain: [xLo, Math.max(xLo + 1, xHi)],
    yDomain: [ymin, ymax],
    title: `${data.variable}  running basic R-hat`,
    xLabel: "iteration",
    yLabel: "R-hat",
  });
  const ref = (y: number, col: string): string =>
    svgLine(frame.area.left, frame.y.map(y), frame.area.right, frame.y.map(y), col);
  const line = svgPolyline(
    data.iterations.map(
      (it, i) => [frame.x.map(it), frame.y.map(data.rhat[i] ?? 0)] as [number, number],
    ),
    seriesColor(0),
  );
  return frame.render(ref(1, "#22c55e") + ref(1.05, "#ef4444") + line);
}

/** Shared layout for interval rows (q5..q95 thin, q25..q75 thick, median dot). */
function renderIntervalRows(
  rows: IntervalRow[],
  opts: SvgOptions,
  title: string,
  perRowColor: boolean,
): string {
  if (rows.length === 0)
    return svgFrame({
      width: opts.width ?? W,
      height: 80,
      xDomain: [0, 1],
      yDomain: [0, 1],
      title,
    }).render("");

  let xmin = Number.POSITIVE_INFINITY;
  let xmax = Number.NEGATIVE_INFINITY;
  for (const r of rows) {
    xmin = Math.min(xmin, r.q5);
    xmax = Math.max(xmax, r.q95);
  }
  const [lo, hi] = niceDomain(xmin, xmax);
  const height = opts.height ?? Math.max(120, 48 + rows.length * 26);
  const frame = svgFrame({
    width: opts.width ?? W,
    height,
    xDomain: [lo, hi],
    yDomain: [rows.length, 0],
    title,
    yLabels: rows.map((r) => r.label),
  });
  const content = rows
    .map((r, i) => {
      const yc = frame.y.map(i + 0.5);
      const col = perRowColor ? seriesColor(r.chain ?? i) : seriesColor(0);
      const tip = `${r.label}  median ${fmtNum(r.q50)}  50% [${fmtNum(r.q25)}, ${fmtNum(r.q75)}]  90% [${fmtNum(r.q5)}, ${fmtNum(r.q95)}]`;
      return [
        svgLine(frame.x.map(r.q5), yc, frame.x.map(r.q95), yc, col, 1, tip),
        svgLine(frame.x.map(r.q25), yc, frame.x.map(r.q75), yc, col, 4, tip),
        svgCircle(frame.x.map(r.q50), yc, 3, "var(--mcmc-fg,#111)", tip),
      ].join("");
    })
    .join("");
  return frame.render(content);
}

/** Per-chain credible intervals for one variable. */
export function renderChainIntervalsSVG(data: ChainIntervalsData, opts: SvgOptions = {}): string {
  return renderIntervalRows(data.rows, opts, `chain intervals: ${data.variable}`, true);
}

/** Pooled credible intervals across variables. */
export function renderChainIntervalsAllSVG(
  data: ChainIntervalsAllData,
  opts: SvgOptions = {},
): string {
  return renderIntervalRows(data.rows, opts, "chain intervals (all variables)", false);
}

/** Violin plot: a mirrored, peak-normalized KDE band per chain with a median tick. */
export function renderViolinSVG(data: ViolinData, opts: SvgOptions = {}): string {
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
    xmin = Math.min(xmin, r.x[0] ?? 0);
    xmax = Math.max(xmax, r.x[r.x.length - 1] ?? 1);
  }
  const [lo, hi] = niceDomain(xmin, xmax);
  const height = opts.height ?? Math.max(140, 48 + rows.length * 48);
  const frame = svgFrame({
    width: opts.width ?? W,
    height,
    xDomain: [lo, hi],
    yDomain: [rows.length, 0],
    title: `${data.variable}  violin`,
    yLabels: rows.map((r) => r.label),
  });
  const half = 0.42;
  const content = rows
    .map((r, i) => {
      const center = i + 0.5;
      const top: [number, number][] = r.x.map((xv, k) => [
        frame.x.map(xv),
        frame.y.map(center - (r.density[k] ?? 0) * half),
      ]);
      const bottom: [number, number][] = r.x.map((xv, k) => [
        frame.x.map(xv),
        frame.y.map(center + (r.density[k] ?? 0) * half),
      ]);
      const tip = `${r.label}  median ${fmtNum(r.q50)}`;
      const outline = svgPolyline(
        [...top, ...bottom.reverse()],
        seriesColor(r.chain ?? i),
        1.25,
        tip,
      );
      const median = svgLine(
        frame.x.map(r.q50),
        frame.y.map(center - half),
        frame.x.map(r.q50),
        frame.y.map(center + half),
        "var(--mcmc-fg,#111)",
        1,
        tip,
      );
      return outline + median;
    })
    .join("");
  return frame.render(content);
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
      const tip = `${r.variable}  mean ${fmtNum(r.mean)}  HDI [${fmtNum(r.hdi[0])}, ${fmtNum(r.hdi[1])}]  R-hat ${Number.isFinite(r.rhat) ? r.rhat.toFixed(3) : "n/a"}  ESS ${Number.isFinite(r.essBulk) ? Math.round(r.essBulk) : "n/a"}`;
      return [
        svgLine(frame.x.map(r.hdi[0]), yc, frame.x.map(r.hdi[1]), yc, col, 1, tip),
        svgLine(frame.x.map(r.iqr[0]), yc, frame.x.map(r.iqr[1]), yc, col, 4, tip),
        svgCircle(frame.x.map(r.mean), yc, 3, "var(--mcmc-fg,#111)", tip),
      ].join("");
    })
    .join("");
  return frame.render(content);
}

const TABLE_BAD = "#ef4444";
const TABLE_WARN = "#eab308";
const TABLE_GOOD = "#22c55e";

function essColor(v: number): string {
  if (!Number.isFinite(v)) return "var(--mcmc-muted,#888)";
  return v > 400 ? TABLE_GOOD : v > 100 ? TABLE_WARN : TABLE_BAD;
}
function rhatColor(v: number): string {
  if (!Number.isFinite(v)) return "var(--mcmc-muted,#888)";
  return v < 1.05 ? TABLE_GOOD : v < 1.1 ? TABLE_WARN : TABLE_BAD;
}
function gewekeColor(z: number): string {
  if (!Number.isFinite(z)) return "var(--mcmc-muted,#888)";
  const a = Math.abs(z);
  return a < 1.96 ? TABLE_GOOD : a < 2.58 ? TABLE_WARN : TABLE_BAD;
}
function sNum3(v: number): string {
  return Number.isFinite(v) ? v.toFixed(3) : "—";
}
function sNum4(v: number): string {
  return Number.isFinite(v) ? v.toFixed(4) : "—";
}
function sInt(v: number): string {
  return Number.isFinite(v) ? String(Math.round(v)) : "—";
}

function svgTextEl(x: number, y: number, text: string, anchor: string, fill: string): string {
  return `<text x="${x.toFixed(2)}" y="${y.toFixed(2)}" text-anchor="${anchor}" fill="${fill}">${escText(text)}</text>`;
}

function wrapSvg(width: number, height: number, body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="${FONT}" font-size="12"><rect x="0" y="0" width="${width}" height="${height}" fill="var(--mcmc-bg,#ffffff)"/>${body}</svg>`;
}

/** Summary table as an SVG grid of right-aligned cells with traffic-light coloring. */
export function renderSummaryTableSVG(data: SummaryTableData, opts: SvgOptions = {}): string {
  const headers = [
    "parameter",
    "Mean",
    "Std",
    "MCSE",
    "5%",
    "25%",
    "50%",
    "75%",
    "95%",
    "ESS",
    "Bulk ESS",
    "Tail ESS",
    "R̂",
    "Split R̂",
    "Geweke z",
    "HDI 90%",
  ];
  const cellsFor = (r: SummaryTableData["rows"][number]): { text: string; fill: string }[] => [
    { text: r.variable, fill: "var(--mcmc-fg,#111)" },
    { text: sNum4(r.mean), fill: "var(--mcmc-fg,#333)" },
    { text: sNum4(r.std), fill: "var(--mcmc-fg,#333)" },
    { text: sNum4(r.mcse), fill: "var(--mcmc-fg,#333)" },
    { text: sNum4(r.q5), fill: "var(--mcmc-fg,#333)" },
    { text: sNum4(r.q25), fill: "var(--mcmc-fg,#333)" },
    { text: sNum4(r.q50), fill: "var(--mcmc-fg,#333)" },
    { text: sNum4(r.q75), fill: "var(--mcmc-fg,#333)" },
    { text: sNum4(r.q95), fill: "var(--mcmc-fg,#333)" },
    { text: sInt(r.ess), fill: essColor(r.ess) },
    { text: sInt(r.essBulk), fill: essColor(r.essBulk) },
    { text: sInt(r.essTail), fill: essColor(r.essTail) },
    { text: sNum3(r.rhat), fill: rhatColor(r.rhat) },
    { text: sNum3(r.splitRhat), fill: rhatColor(r.splitRhat) },
    { text: sNum3(r.gewekeZ), fill: gewekeColor(r.gewekeZ) },
    { text: `[${sNum3(r.hdi90[0])}, ${sNum3(r.hdi90[1])}]`, fill: "var(--mcmc-fg,#333)" },
  ];

  const body = data.rows.map(cellsFor);
  const charW = 7.4;
  const widths = headers.map((h, c) =>
    Math.max(h.length, ...body.map((cells) => (cells[c]?.text ?? "").length)),
  );
  const colX: number[] = [];
  let x = 12;
  for (let c = 0; c < widths.length; c++) {
    colX.push(x);
    x += (widths[c] ?? 0) * charW + 14;
  }
  const width = opts.width ?? Math.ceil(x);
  const rowH = 20;
  const top = 28;
  const height = opts.height ?? top + (body.length + 1) * rowH + 8;

  const parts: string[] = [];
  parts.push(svgTextEl(12, 18, "summary", "start", "var(--mcmc-fg,#111)"));
  headers.forEach((h, c) => {
    const cx = (colX[c] ?? 0) + (c === 0 ? 0 : (widths[c] ?? 0) * charW);
    parts.push(svgTextEl(cx, top, h, c === 0 ? "start" : "end", "var(--mcmc-fg,#111)"));
  });
  body.forEach((cells, i) => {
    const y = top + (i + 1) * rowH;
    if (i % 2 === 1) {
      parts.push(svgRect(0, y - 14, width, rowH, "var(--mcmc-grid,#f3f4f6)"));
    }
    cells.forEach((cell, c) => {
      const cx = (colX[c] ?? 0) + (c === 0 ? 0 : (widths[c] ?? 0) * charW);
      parts.push(svgTextEl(cx, y, cell.text, c === 0 ? "start" : "end", cell.fill));
    });
  });
  return wrapSvg(width, height, parts.join(""));
}

/** Diagnostics heatmap: a variable x metric grid of color-filled cells with centered text. */
export function renderDiagnosticsHeatmapSVG(
  data: DiagnosticsHeatmapData,
  opts: SvgOptions = {},
): string {
  const labelW = 90;
  const cellW = 92;
  const cellH = 26;
  const top = 28;
  const headerH = 22;
  const width = opts.width ?? labelW + data.metrics.length * cellW + 12;
  const height = opts.height ?? top + headerH + data.rows.length * cellH + 8;

  const parts: string[] = [];
  parts.push(svgTextEl(12, 18, "diagnostics", "start", "var(--mcmc-fg,#111)"));
  data.metrics.forEach((m, c) => {
    const cx = labelW + c * cellW + cellW / 2;
    parts.push(svgTextEl(cx, top + headerH - 8, m, "middle", "var(--mcmc-fg,#111)"));
  });
  data.rows.forEach((row, i) => {
    const y = top + headerH + i * cellH;
    parts.push(
      svgTextEl(labelW - 6, y + cellH / 2 + 4, row.variable, "end", "var(--mcmc-fg,#111)"),
    );
    row.cells.forEach((cell, c) => {
      const cx = labelW + c * cellW;
      const [r, g, b] = cell.rgb;
      parts.push(
        svgRect(
          cx,
          y,
          cellW - 2,
          cellH - 2,
          `rgb(${r},${g},${b})`,
          `${row.variable}  ${data.metrics[c]}: ${cell.text}`,
        ),
      );
      parts.push(svgTextEl(cx + cellW / 2, y + cellH / 2 + 4, cell.text, "middle", "#fff"));
    });
  });
  return wrapSvg(width, height, parts.join(""));
}

function svgTextSized(
  x: number,
  y: number,
  text: string,
  anchor: string,
  fill: string,
  size: number,
): string {
  return `<text x="${x.toFixed(2)}" y="${y.toFixed(2)}" text-anchor="${anchor}" font-size="${size}" fill="${fill}">${escText(text)}</text>`;
}

/**
 * Scatter-plot matrix: an N x N grid. The diagonal draws each variable's KDE and label,
 * the upper triangle a correlation-tinted cell with the Pearson r (and smaller Spearman rho),
 * and the lower triangle the joint draws colored by chain.
 */
export function renderSplomSVG(data: SplomData, opts: SvgOptions = {}): string {
  const n = data.vars.length;
  if (n === 0) return wrapSvg(opts.width ?? W, opts.height ?? 80, "");

  const cell = Math.max(60, Math.floor(((opts.width ?? 520) - 16) / Math.max(1, n)));
  const pad = 8;
  const grid = n * cell + 2 * pad;
  const width = opts.width ?? grid;
  const height = opts.height ?? grid + 24;
  const top = 24;

  // Per-variable pooled extent (from the diagonal KDE grid) drives both axes.
  const range = data.diagonals.map((d) => {
    const lo = d.x[0] ?? 0;
    const hi = d.x[d.x.length - 1] ?? 1;
    return { lo, hi, span: hi - lo || 1 };
  });
  const corrAt = new Map<string, (typeof data.corr)[number]>();
  for (const c of data.corr) corrAt.set(`${c.row}:${c.col}`, c);

  const parts: string[] = [
    svgTextEl(pad, 16, `pairs (${n} vars, ${data.nChains} chains)`, "start", "var(--mcmc-fg,#111)"),
  ];
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      const x0 = pad + col * cell;
      const y0 = top + row * cell;
      parts.push(
        `<rect x="${x0}" y="${y0}" width="${cell - 2}" height="${cell - 2}" fill="none" stroke="var(--mcmc-grid,#e5e7eb)"/>`,
      );
      const rx = range[col] ?? { lo: 0, hi: 1, span: 1 };
      const ry = range[row] ?? { lo: 0, hi: 1, span: 1 };
      const px = (v: number): number => x0 + ((v - rx.lo) / rx.span) * (cell - 2);
      const py = (v: number): number => y0 + (cell - 2) - ((v - ry.lo) / ry.span) * (cell - 2);

      if (row === col) {
        const d = data.diagonals[row];
        if (d) {
          const pts: [number, number][] = d.x.map((xv, k) => [
            px(xv),
            y0 + (cell - 2) - (d.density[k] ?? 0) * (cell - 6),
          ]);
          parts.push(svgPolyline(pts, seriesColor(0), 1.25, d.variable));
          parts.push(svgTextSized(x0 + 4, y0 + 12, d.variable, "start", "var(--mcmc-fg,#111)", 11));
        }
      } else if (row < col) {
        const c = corrAt.get(`${row}:${col}`);
        const r = c?.pearson ?? 0;
        const rho = c?.spearman ?? 0;
        const alpha = Math.min(Math.abs(r) * 0.45, 0.42);
        const tint =
          r >= 0 ? `rgba(37,99,235,${alpha.toFixed(3)})` : `rgba(220,38,38,${alpha.toFixed(3)})`;
        parts.push(
          svgRect(
            x0,
            y0,
            cell - 2,
            cell - 2,
            tint,
            `${data.vars[row]} vs ${data.vars[col]}  Pearson r ${r.toFixed(3)}, Spearman rho ${rho.toFixed(3)}`,
          ),
        );
        const cx = x0 + (cell - 2) / 2;
        parts.push(
          svgTextSized(
            cx,
            y0 + (cell - 2) / 2,
            `r ${r.toFixed(2)}`,
            "middle",
            "var(--mcmc-fg,#111)",
            13,
          ),
        );
        parts.push(
          svgTextSized(
            cx,
            y0 + (cell - 2) / 2 + 14,
            `rho ${rho.toFixed(2)}`,
            "middle",
            "var(--mcmc-muted,#6b7280)",
            10,
          ),
        );
      } else {
        const c = data.cells.find((e) => e.row === row && e.col === col);
        if (c) {
          for (let i = 0; i < c.x.length; i++) {
            parts.push(
              svgCircle(
                px(c.x[i] ?? 0),
                py(c.y[i] ?? 0),
                1,
                seriesColor(c.chain[i] ?? 0),
                `${data.vars[col]} ${fmtNum(c.x[i] ?? 0)}, ${data.vars[row]} ${fmtNum(c.y[i] ?? 0)} · chain ${(c.chain[i] ?? 0) + 1}`,
              ),
            );
          }
        }
      }
    }
  }
  return wrapSvg(width, height, parts.join(""));
}

/**
 * Parallel-coordinates plot: one vertical axis per variable (labeled with its min/max) and
 * one polyline per sampled draw across the axes, normalized per axis and colored by chain.
 */
export function renderParallelCoordsSVG(data: ParallelCoordsData, opts: SvgOptions = {}): string {
  const n = data.vars.length;
  const width = opts.width ?? Math.max(W, 80 * n);
  const height = opts.height ?? 300;
  if (n === 0) return wrapSvg(width, 80, "");

  const left = 40;
  const right = width - 40;
  const top = 36;
  const bottom = height - 36;
  const span = bottom - top;
  const axisX = (i: number): number =>
    n === 1 ? (left + right) / 2 : left + (i / (n - 1)) * (right - left);

  const norm = data.bounds.map((b) => ({ min: b.min, range: b.max - b.min || 1 }));
  const yOf = (vi: number, value: number): number => {
    const nb = norm[vi] ?? { min: 0, range: 1 };
    const t = (value - nb.min) / nb.range;
    const tc = t < 0 ? 0 : t > 1 ? 1 : t;
    return bottom - tc * span;
  };

  const parts: string[] = [
    svgTextEl(
      left,
      18,
      `parallel coordinates (${n} vars, ${data.lines.length} draws)`,
      "start",
      "var(--mcmc-fg,#111)",
    ),
  ];

  // Lines first so axes and labels sit on top.
  for (const line of data.lines) {
    const pts: [number, number][] = line.values.map((v, vi) => [axisX(vi), yOf(vi, v)]);
    parts.push(svgPolyline(pts, seriesColor(line.chain), 0.6, `chain ${line.chain + 1}`));
  }

  data.vars.forEach((variable, i) => {
    const x = axisX(i);
    parts.push(svgLine(x, top, x, bottom, "var(--mcmc-fg,#333)"));
    const b = data.bounds[i] ?? { min: 0, max: 1 };
    parts.push(svgTextSized(x, top - 6, variable, "middle", "var(--mcmc-fg,#111)", 11));
    parts.push(svgTextSized(x, top - 18, fmtNum(b.max), "middle", "var(--mcmc-muted,#6b7280)", 10));
    parts.push(
      svgTextSized(x, bottom + 14, fmtNum(b.min), "middle", "var(--mcmc-muted,#6b7280)", 10),
    );
  });

  return wrapSvg(width, height, parts.join(""));
}

interface CellScale {
  px: (v: number) => number;
  py: (v: number) => number;
}

function cornerBodyLayerSVG(layer: CornerBodyLayer, scale: CellScale, swap: boolean): string {
  const px = (x: number, y: number): number => scale.px(swap ? y : x);
  const py = (x: number, y: number): number => scale.py(swap ? x : y);
  const parts: string[] = [];
  switch (layer.type) {
    case "hexbin": {
      for (let i = 0; i < layer.cx.length; i++) {
        const w = (layer.weight[i] ?? 0) / (layer.wmax || 1);
        if (w <= 0) continue;
        const cx = layer.cx[i] ?? 0;
        const cy = layer.cy[i] ?? 0;
        const hx = layer.hexX;
        const hy = layer.hexY;
        const verts: [number, number][] = [
          [cx, cy + hy],
          [cx + hx, cy + hy / 2],
          [cx + hx, cy - hy / 2],
          [cx, cy - hy],
          [cx - hx, cy - hy / 2],
          [cx - hx, cy + hy / 2],
        ];
        const d = polygonPathD(verts.map(([x, y]) => [px(x, y), py(x, y)]));
        parts.push(
          svgPath(d, { fill: layer.color, fillOpacity: w, tip: `n = ${layer.weight[i] ?? 0}` }),
        );
      }
      break;
    }
    case "hist2d": {
      const bw = layer.x.length > 1 ? (layer.x[1] as number) - (layer.x[0] as number) : 1;
      const bh = layer.y.length > 1 ? (layer.y[1] as number) - (layer.y[0] as number) : 1;
      for (let i = 0; i < layer.x.length; i++) {
        for (let j = 0; j < layer.y.length; j++) {
          const w = ((layer.weights[i] as number[])[j] ?? 0) / (layer.wmax || 1);
          if (w <= 0) continue;
          const cx = layer.x[i] as number;
          const cy = layer.y[j] as number;
          const x1 = px(cx - bw / 2, cy - bh / 2);
          const y1 = py(cx - bw / 2, cy + bh / 2);
          const x2 = px(cx + bw / 2, cy + bh / 2);
          const y2 = py(cx + bw / 2, cy - bh / 2);
          parts.push(
            `<rect x="${Math.min(x1, x2).toFixed(2)}" y="${Math.min(y1, y2).toFixed(2)}" width="${Math.abs(x2 - x1).toFixed(2)}" height="${Math.abs(y2 - y1).toFixed(2)}" fill="${layer.color}" fill-opacity="${w.toFixed(3)}" data-tip="n = ${(layer.weights[i] as number[])[j] ?? 0}"/>`,
          );
        }
      }
      break;
    }
    case "contour": {
      for (const level of layer.levels) {
        for (const ring of level.rings) {
          const pts: [number, number][] = ring.x.map((x, k) => [
            px(x, ring.y[k] as number),
            py(x, ring.y[k] as number),
          ]);
          const d = pts
            .map(([x, y], k) => `${k === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`)
            .join(" ");
          parts.push(
            svgPath(d, {
              stroke: layer.color,
              strokeWidth: layer.linewidth,
              tip: `${level.sigma}σ`,
            }),
          );
        }
      }
      break;
    }
    case "contourf": {
      for (const poly of layer.polygons) {
        const d = poly.rings
          .map((ring) =>
            polygonPathD(
              ring.x.map((x, k) => [px(x, ring.y[k] as number), py(x, ring.y[k] as number)]),
            ),
          )
          .filter(Boolean)
          .join(" ");
        parts.push(
          svgPath(d, { fill: layer.color, fillRule: "evenodd", fillOpacity: layer.alpha }),
        );
      }
      break;
    }
    case "scatter": {
      const r = Math.max(0.8, layer.markersize);
      for (let i = 0; i < layer.x.length; i++) {
        parts.push(
          svgCircle(
            px(layer.x[i] as number, layer.y[i] as number),
            py(layer.x[i] as number, layer.y[i] as number),
            r,
            layer.color,
            `${fmtNum(layer.x[i] as number)}, ${fmtNum(layer.y[i] as number)}`,
          ),
        );
      }
      break;
    }
    default:
      break;
  }
  return parts.join("");
}

/**
 * Corner (pair) plot: a PairPlots.jl-style N x N grid with layered body cells
 * (hexbin, filtered scatter, sigma contours, filled contours, trend and truth
 * lines) below the diagonal and layered marginals plus quantile titles on it.
 */
export function renderCornerSVG(data: CornerData, opts: SvgOptions = {}): string {
  const n = data.vars.length;
  if (n === 0) return wrapSvg(opts.width ?? W, opts.height ?? 80, "");
  const showDiag = data.diagonal;
  const maxTitles = showDiag ? Math.max(0, ...data.diags.map((d) => d.titles.length)) : 0;
  const titleH = maxTitles > 0 ? 13 * maxTitles + 4 : 0;

  const left = 56;
  const pad = 10;
  const bottom = 44;
  const gap = 6;
  const rows = showDiag ? n : n - 1;
  const cols = showDiag || data.fullgrid ? n : n - 1;
  const cell = opts.width
    ? Math.max(80, Math.floor((opts.width - left - pad - gap * (cols - 1)) / Math.max(1, cols)))
    : 150;
  const width = opts.width ?? left + cols * cell + gap * (cols - 1) + pad;
  const rowPitch = cell + titleH + gap;
  const height = opts.height ?? pad + rows * rowPitch - gap - titleH + bottom;

  // Grid geometry: variable v's column and row indices (diagonal-less grids
  // drop the first row and last column of the full corner layout).
  const colOf = (v: number): number => v;
  const rowOf = (v: number): number => (showDiag ? v : v - 1);
  const cellX = (v: number): number => left + colOf(v) * (cell + gap);
  const cellY = (v: number): number => pad + rowOf(v) * rowPitch + titleH;

  const pads = data.domains.map(([lo, hi]) => {
    const span = hi - lo || 1;
    return { lo: lo - 0.04 * span, span: span * 1.08 };
  });
  const scaleFor = (xVar: number, yVar: number, x0: number, y0: number): CellScale => {
    const dx = pads[xVar] ?? { lo: 0, span: 1 };
    const dy = pads[yVar] ?? { lo: 0, span: 1 };
    return {
      px: (v: number) => x0 + ((v - dx.lo) / dx.span) * cell,
      py: (v: number) => y0 + cell - ((v - dy.lo) / dy.span) * cell,
    };
  };

  const defs: string[] = [];
  const parts: string[] = [];
  let clipId = 0;
  const clipped = (x0: number, y0: number, body: string): void => {
    if (!body) return;
    clipId += 1;
    const id = `corner-clip-${clipId}`;
    defs.push(
      `<clipPath id="${id}"><rect x="${x0}" y="${y0}" width="${cell}" height="${cell}"/></clipPath>`,
    );
    parts.push(`<g clip-path="url(#${id})">${body}</g>`);
  };
  const frame = (x0: number, y0: number): void => {
    parts.push(
      `<rect x="${x0}" y="${y0}" width="${cell}" height="${cell}" fill="none" stroke="var(--mcmc-grid,#d1d5db)"/>`,
    );
  };

  const bodyCell = (row: number, col: number, layers: CornerBodyLayer[], swap: boolean): void => {
    const xVar = swap ? row : col;
    const yVar = swap ? col : row;
    const gx = swap ? colOf(row) : colOf(col);
    const gy = swap ? rowOf(col) : rowOf(row);
    const x0 = left + gx * (cell + gap);
    const y0 = pad + gy * rowPitch + titleH;
    frame(x0, y0);
    const scale = scaleFor(xVar, yVar, x0, y0);
    const painted: string[] = [];
    for (const layer of layers) {
      if (layer.type === "trendline") {
        const dx = pads[xVar] ?? { lo: 0, span: 1 };
        const xa = dx.lo;
        const xb = dx.lo + dx.span;
        const ya = layer.m * xa + layer.b;
        const yb = layer.m * xb + layer.b;
        const p1: [number, number] = swap ? [ya, xa] : [xa, ya];
        const p2: [number, number] = swap ? [yb, xb] : [xb, yb];
        painted.push(
          svgLine(
            scale.px(p1[0]),
            scale.py(p1[1]),
            scale.px(p2[0]),
            scale.py(p2[1]),
            layer.color,
            1.25,
          ),
        );
      } else if (layer.type === "correlation") {
        parts.push(
          svgTextSized(
            x0 + (layer.position[0] ?? 0) * cell + 3,
            y0 + (1 - (layer.position[1] ?? 1)) * cell + 11,
            `r = ${layer.value.toFixed(layer.digits)}`,
            "start",
            "var(--mcmc-fg,#111)",
            10,
          ),
        );
      } else if (layer.type === "bodylines") {
        const vs = swap ? layer.ys : layer.xs;
        const hs = swap ? layer.xs : layer.ys;
        for (const v of vs) {
          painted.push(svgLine(scale.px(v), y0, scale.px(v), y0 + cell, layer.color, 1));
        }
        for (const h of hs) {
          painted.push(svgLine(x0, scale.py(h), x0 + cell, scale.py(h), layer.color, 1));
        }
      } else if (layer.type === "bodybands") {
        const vRanges = swap ? layer.y : layer.x;
        const hRanges = swap ? layer.x : layer.y;
        for (const [lo, hi] of vRanges) {
          const xa = scale.px(lo);
          const xb = scale.px(hi);
          painted.push(
            `<rect x="${Math.min(xa, xb).toFixed(2)}" y="${y0}" width="${Math.abs(xb - xa).toFixed(2)}" height="${cell}" fill="${layer.color}" fill-opacity="${layer.alpha}"/>`,
          );
        }
        for (const [lo, hi] of hRanges) {
          const ya = scale.py(hi);
          const yb = scale.py(lo);
          painted.push(
            `<rect x="${x0}" y="${Math.min(ya, yb).toFixed(2)}" width="${cell}" height="${Math.abs(yb - ya).toFixed(2)}" fill="${layer.color}" fill-opacity="${layer.alpha}"/>`,
          );
        }
      } else {
        painted.push(cornerBodyLayerSVG(layer, scale, swap));
      }
    }
    clipped(x0, y0, painted.join(""));
  };

  for (const c of data.cells) {
    bodyCell(c.row, c.col, c.layers, false);
    if (data.fullgrid) bodyCell(c.row, c.col, c.layers, true);
  }

  if (showDiag) {
    for (const diag of data.diags) {
      const v = diag.index;
      const x0 = cellX(v);
      const y0 = cellY(v);
      frame(x0, y0);
      const dx = pads[v] ?? { lo: 0, span: 1 };
      const px = (value: number): number => x0 + ((value - dx.lo) / dx.span) * cell;
      let ymax = 0;
      for (const layer of diag.layers) {
        if (layer.type === "marginhist" || layer.type === "marginstephist") {
          for (const w of layer.weights) if (w > ymax) ymax = w;
        } else if (layer.type === "margindensity") {
          for (const w of layer.y) if (w > ymax) ymax = w;
        }
      }
      if (ymax <= 0) ymax = 1;
      const py = (w: number): number => y0 + cell - (w / ymax) * (cell - 8);
      const painted: string[] = [];
      for (const layer of diag.layers) {
        switch (layer.type) {
          case "marginhist": {
            const bw = layer.x.length > 1 ? (layer.x[1] as number) - (layer.x[0] as number) : 1;
            for (let i = 0; i < layer.x.length; i++) {
              const c = layer.x[i] as number;
              const x1 = px(c - bw / 2);
              const x2 = px(c + bw / 2);
              const yTop = py(layer.weights[i] as number);
              painted.push(
                `<rect x="${x1.toFixed(2)}" y="${yTop.toFixed(2)}" width="${(x2 - x1).toFixed(2)}" height="${(y0 + cell - yTop).toFixed(2)}" fill="${layer.color}"/>`,
              );
            }
            break;
          }
          case "marginstephist": {
            const bw = layer.x.length > 1 ? (layer.x[1] as number) - (layer.x[0] as number) : 1;
            const pts: [number, number][] = [];
            for (let i = 0; i < layer.x.length; i++) {
              const c = layer.x[i] as number;
              const w = layer.weights[i] as number;
              pts.push([px(c - bw / 2), py(w)]);
              pts.push([px(c + bw / 2), py(w)]);
            }
            painted.push(svgPolyline(pts, layer.color, 1.25));
            break;
          }
          case "margindensity": {
            const pts: [number, number][] = layer.x.map((c, k) => [
              px(c),
              py(layer.y[k] as number),
            ]);
            painted.push(svgPolyline(pts, layer.color, layer.linewidth));
            break;
          }
          case "marginquantilelines": {
            for (const value of layer.values) {
              painted.push(
                svgPath(`M${px(value).toFixed(2)} ${y0} L${px(value).toFixed(2)} ${y0 + cell}`, {
                  stroke: layer.color,
                  strokeWidth: 1,
                  strokeDash: "4 3",
                  tip: fmtNum(value),
                }),
              );
            }
            break;
          }
          case "marginlines": {
            for (const value of layer.values) {
              painted.push(
                svgLine(
                  px(value),
                  y0,
                  px(value),
                  y0 + cell,
                  layer.color,
                  1.25,
                  `truth ${fmtNum(value)}`,
                ),
              );
            }
            break;
          }
          case "marginbands": {
            for (const [lo, hi] of layer.ranges) {
              const x1 = px(lo);
              const x2 = px(hi);
              painted.push(
                `<rect x="${Math.min(x1, x2).toFixed(2)}" y="${y0}" width="${Math.abs(x2 - x1).toFixed(2)}" height="${cell}" fill="${layer.color}" fill-opacity="${layer.alpha}"/>`,
              );
            }
            break;
          }
          default:
            break;
        }
      }
      clipped(x0, y0, painted.join(""));
      diag.titles.forEach((title, i) => {
        parts.push(
          svgTextSized(
            x0 + cell / 2,
            y0 - 6 - 13 * (diag.titles.length - 1 - i),
            title.text,
            "middle",
            title.color,
            10,
          ),
        );
      });
    }
  }

  // Edge labels: variable names below the bottom row and left of each row.
  for (let v = 0; v < n; v++) {
    const isBottomRow = showDiag || data.fullgrid ? true : v < n - 1;
    if (isBottomRow) {
      const x0 = cellX(v);
      const yEdge = pad + rows * rowPitch - gap - titleH;
      parts.push(
        svgTextSized(
          x0 + cell / 2,
          yEdge + 16,
          data.labels[v] ?? "",
          "middle",
          "var(--mcmc-fg,#111)",
          12,
        ),
      );
      const dx = pads[v] ?? { lo: 0, span: 1 };
      parts.push(
        svgTextSized(x0, yEdge + 30, fmtNum(dx.lo), "start", "var(--mcmc-muted,#6b7280)", 9),
      );
      parts.push(
        svgTextSized(
          x0 + cell,
          yEdge + 30,
          fmtNum(dx.lo + dx.span),
          "end",
          "var(--mcmc-muted,#6b7280)",
          9,
        ),
      );
    }
    if (showDiag ? v > 0 : v > 0) {
      const y0 = cellY(v);
      parts.push(
        `<text x="${left - 8}" y="${(y0 + cell / 2).toFixed(2)}" text-anchor="middle" font-size="12" fill="var(--mcmc-fg,#111)" transform="rotate(-90 ${left - 8} ${(y0 + cell / 2).toFixed(2)})">${escText(data.labels[v] ?? "")}</text>`,
      );
    }
  }

  // Legend from labeled series.
  const labeled = data.series.filter((s) => s.label);
  labeled.forEach((s, i) => {
    const ly = pad + 14 * i + 10;
    parts.push(svgRect(width - 130, ly - 8, 10, 10, s.color));
    parts.push(svgTextSized(width - 116, ly, s.label ?? "", "start", "var(--mcmc-fg,#111)", 11));
  });

  return wrapSvg(width, height, `<defs>${defs.join("")}</defs>${parts.join("")}`);
}
