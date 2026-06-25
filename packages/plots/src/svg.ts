import {
  extent,
  fmtNum,
  niceDomain,
  seriesColor,
  svgCircle,
  svgFrame,
  svgLine,
  svgPolyline,
  svgRect,
  viridisHex,
} from "@mcmcjs/charts";
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
  RankData,
  RunningRhatData,
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
  const curve = (counts: number[], series: number): string =>
    svgPolyline(
      counts.map((c, b) => [frame.x.map(centers[b] ?? 0), frame.y.map(c)] as [number, number]),
      seriesColor(series),
    );
  return frame.render(curve(data.marginal, 0) + curve(data.transition, 1));
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
    `<text x="${x0.toFixed(2)}" y="${(y0 + barH + 11).toFixed(2)}" text-anchor="start" fill="#333">${escText(fmtNum(lo))}</text>`,
  );
  parts.push(
    `<text x="${(x0 + barW).toFixed(2)}" y="${(y0 + barH + 11).toFixed(2)}" text-anchor="end" fill="#333">${escText(fmtNum(hi))}</text>`,
  );
  parts.push(
    `<text x="${(x0 + barW / 2).toFixed(2)}" y="${(y0 - 3).toFixed(2)}" text-anchor="middle" fill="#333">color: ${escText(label)}</text>`,
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

  const dot = (i: number, r: number, fill: string): string =>
    svgCircle(frame.x.map(data.x[i] ?? 0), frame.y.map(data.y[i] ?? 0), r, fill);
  const normal = normalIdx
    .filter((_, k) => k % step === 0)
    .map((i) => dot(i, 1.4, fillFor(i)))
    .join("");
  const divergent = divergentIdx.map((i) => dot(i, 2.5, "#d62728")).join("");
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
      const col = perRowColor ? seriesColor(i) : seriesColor(0);
      return [
        svgLine(frame.x.map(r.q5), yc, frame.x.map(r.q95), yc, col, 1),
        svgLine(frame.x.map(r.q25), yc, frame.x.map(r.q75), yc, col, 4),
        svgCircle(frame.x.map(r.q50), yc, 3, "#111"),
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
      const outline = svgPolyline([...top, ...bottom.reverse()], seriesColor(i));
      const median = svgLine(
        frame.x.map(r.q50),
        frame.y.map(center - half),
        frame.x.map(r.q50),
        frame.y.map(center + half),
        "#111",
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
      return [
        svgLine(frame.x.map(r.hdi[0]), yc, frame.x.map(r.hdi[1]), yc, col, 1),
        svgLine(frame.x.map(r.iqr[0]), yc, frame.x.map(r.iqr[1]), yc, col, 4),
        svgCircle(frame.x.map(r.mean), yc, 3, "#111"),
      ].join("");
    })
    .join("");
  return frame.render(content);
}

const TABLE_BAD = "#ef4444";
const TABLE_WARN = "#eab308";
const TABLE_GOOD = "#22c55e";

function essColor(v: number): string {
  if (!Number.isFinite(v)) return "#888";
  return v > 400 ? TABLE_GOOD : v > 100 ? TABLE_WARN : TABLE_BAD;
}
function rhatColor(v: number): string {
  if (!Number.isFinite(v)) return "#888";
  return v < 1.05 ? TABLE_GOOD : v < 1.1 ? TABLE_WARN : TABLE_BAD;
}
function gewekeColor(z: number): string {
  if (!Number.isFinite(z)) return "#888";
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
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="${FONT}" font-size="12"><rect x="0" y="0" width="${width}" height="${height}" fill="#ffffff"/>${body}</svg>`;
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
    { text: r.variable, fill: "#111" },
    { text: sNum4(r.mean), fill: "#333" },
    { text: sNum4(r.std), fill: "#333" },
    { text: sNum4(r.mcse), fill: "#333" },
    { text: sNum4(r.q5), fill: "#333" },
    { text: sNum4(r.q25), fill: "#333" },
    { text: sNum4(r.q50), fill: "#333" },
    { text: sNum4(r.q75), fill: "#333" },
    { text: sNum4(r.q95), fill: "#333" },
    { text: sInt(r.ess), fill: essColor(r.ess) },
    { text: sInt(r.essBulk), fill: essColor(r.essBulk) },
    { text: sInt(r.essTail), fill: essColor(r.essTail) },
    { text: sNum3(r.rhat), fill: rhatColor(r.rhat) },
    { text: sNum3(r.splitRhat), fill: rhatColor(r.splitRhat) },
    { text: sNum3(r.gewekeZ), fill: gewekeColor(r.gewekeZ) },
    { text: `[${sNum3(r.hdi90[0])}, ${sNum3(r.hdi90[1])}]`, fill: "#333" },
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
  parts.push(svgTextEl(12, 18, "summary", "start", "#111"));
  headers.forEach((h, c) => {
    const cx = (colX[c] ?? 0) + (c === 0 ? 0 : (widths[c] ?? 0) * charW);
    parts.push(svgTextEl(cx, top, h, c === 0 ? "start" : "end", "#111"));
  });
  body.forEach((cells, i) => {
    const y = top + (i + 1) * rowH;
    if (i % 2 === 1) {
      parts.push(svgRect(0, y - 14, width, rowH, "#f3f4f6"));
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
  parts.push(svgTextEl(12, 18, "diagnostics", "start", "#111"));
  data.metrics.forEach((m, c) => {
    const cx = labelW + c * cellW + cellW / 2;
    parts.push(svgTextEl(cx, top + headerH - 8, m, "middle", "#111"));
  });
  data.rows.forEach((row, i) => {
    const y = top + headerH + i * cellH;
    parts.push(svgTextEl(labelW - 6, y + cellH / 2 + 4, row.variable, "end", "#111"));
    row.cells.forEach((cell, c) => {
      const cx = labelW + c * cellW;
      const [r, g, b] = cell.rgb;
      parts.push(svgRect(cx, y, cellW - 2, cellH - 2, `rgb(${r},${g},${b})`));
      parts.push(svgTextEl(cx + cellW / 2, y + cellH / 2 + 4, cell.text, "middle", "#fff"));
    });
  });
  return wrapSvg(width, height, parts.join(""));
}
