import {
  axisFrame,
  DotCanvas,
  extent,
  fmtNum,
  linearScale,
  niceDomain,
  sparkline,
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
  SplomData,
  SummaryTableData,
  TerminalOptions,
  TraceData,
  ViolinData,
} from "./types";

const identity = (text: string): string => text;
const GUTTER = 8;

/** Mean of the finite E-BFMI values, or NaN when none are finite. */
function meanBfmi(bfmi: number[]): number {
  const finite = bfmi.filter(Number.isFinite);
  return finite.length ? finite.reduce((a, b) => a + b, 0) / finite.length : Number.NaN;
}

/** Renders a trace plot (one line per chain) as colored terminal text. */
export function renderTraceTerminal(data: TraceData, opts: TerminalOptions = {}): string {
  const charset = opts.charset ?? "unicode";
  const color = opts.color ?? identity;
  const totalWidth = opts.width ?? 72;
  const height = opts.height ?? 12;
  const plotW = Math.max(8, totalWidth - GUTTER - 2);

  const [rawMin, rawMax] = extent(data.chains.flat());
  const [ymin, ymax] = niceDomain(rawMin, rawMax);
  const canvas = new DotCanvas(plotW, height);
  const scaleX = linearScale([0, Math.max(1, data.nDraws - 1)], [0, canvas.wDots - 1]);
  const scaleY = linearScale([ymin, ymax], [canvas.hDots - 1, 0]);

  data.chains.forEach((series, chain) => {
    for (let i = 1; i < series.length; i++) {
      const prev = series[i - 1];
      const cur = series[i];
      if (prev === undefined || cur === undefined) continue;
      canvas.line(scaleX.map(i - 1), scaleY.map(prev), scaleX.map(i), scaleY.map(cur), chain);
    }
    const first = series[0];
    if (series.length === 1 && first !== undefined) canvas.set(0, scaleY.map(first), chain);
  });

  const rhatStr = Number.isFinite(data.rhat) ? data.rhat.toFixed(3) : "n/a";
  const essStr = Number.isFinite(data.essBulk) ? String(Math.round(data.essBulk)) : "n/a";
  const header = `${data.variable}   R-hat ${rhatStr}   ESS ${essStr}   (${data.nChains} chains x ${data.nDraws} draws)`;

  return axisFrame(canvas.rows(charset, color), {
    width: plotW,
    yMin: ymin,
    yMax: ymax,
    xLeft: "0",
    xRight: String(data.nDraws),
    charset,
    header,
    gutter: GUTTER,
  });
}

/** Renders a density plot (one KDE curve per chain) as colored terminal text. */
export function renderDensityTerminal(data: DensityData, opts: TerminalOptions = {}): string {
  const charset = opts.charset ?? "unicode";
  const color = opts.color ?? identity;
  const totalWidth = opts.width ?? 72;
  const height = opts.height ?? 12;
  const plotW = Math.max(8, totalWidth - GUTTER - 2);

  let maxY = 0;
  for (const curve of data.chains) {
    for (const v of curve) if (v > maxY) maxY = v;
  }
  if (maxY <= 0) maxY = 1;

  const x = data.x;
  const xLo = x[0] ?? 0;
  const xHi = x[x.length - 1] ?? 1;
  const canvas = new DotCanvas(plotW, height);
  const scaleX = linearScale([xLo, xHi], [0, canvas.wDots - 1]);
  const scaleY = linearScale([0, maxY], [canvas.hDots - 1, 0]);

  data.chains.forEach((curve, chain) => {
    for (let k = 1; k < curve.length; k++) {
      const y0 = curve[k - 1];
      const y1 = curve[k];
      const x0 = x[k - 1];
      const x1 = x[k];
      if (y0 === undefined || y1 === undefined || x0 === undefined || x1 === undefined) continue;
      canvas.line(scaleX.map(x0), scaleY.map(y0), scaleX.map(x1), scaleY.map(y1), chain);
    }
  });

  const header = `${data.variable}   density   (${data.nChains} chains)`;
  return axisFrame(canvas.rows(charset, color), {
    width: plotW,
    yMin: 0,
    yMax: maxY,
    xLeft: fmtNum(xLo),
    xRight: fmtNum(xHi),
    charset,
    header,
    gutter: GUTTER,
  });
}

/** Renders a pooled histogram (filled columns) as colored terminal text. */
export function renderHistogramTerminal(data: HistogramData, opts: TerminalOptions = {}): string {
  const charset = opts.charset ?? "unicode";
  const color = opts.color ?? identity;
  const totalWidth = opts.width ?? 72;
  const height = opts.height ?? 12;
  const plotW = Math.max(8, totalWidth - GUTTER - 2);

  const bins = data.counts.length;
  const maxC = Math.max(1, ...data.counts);
  const canvas = new DotCanvas(plotW, height);
  const baseline = canvas.hDots - 1;
  const scaleY = linearScale([0, maxC], [baseline, 0]);

  for (let b = 0; b < bins; b++) {
    const top = Math.round(scaleY.map(data.counts[b] ?? 0));
    const xStart = Math.round((b / bins) * canvas.wDots);
    const xEnd = Math.max(xStart + 1, Math.round(((b + 1) / bins) * canvas.wDots));
    for (let px = xStart; px < xEnd && px < canvas.wDots; px++) {
      for (let py = top; py <= baseline; py++) canvas.set(px, py, 0);
    }
  }

  const edges = data.binEdges;
  const header = `${data.variable}   histogram   (${bins} bins, ${data.total} draws)`;
  return axisFrame(canvas.rows(charset, color), {
    width: plotW,
    yMin: 0,
    yMax: maxC,
    xLeft: fmtNum(edges[0] ?? 0),
    xRight: fmtNum(edges[edges.length - 1] ?? 1),
    charset,
    header,
    gutter: GUTTER,
  });
}

/** Renders a rank plot as one per-chain sparkline of bin counts (flat = good mixing). */
export function renderRankTerminal(data: RankData, opts: TerminalOptions = {}): string {
  const charset = opts.charset ?? "unicode";
  const color = opts.color ?? identity;
  const maxCount = Math.max(1, ...data.counts.flat());

  const lines: string[] = [
    `${data.variable}   rank (${data.bins} bins, ${data.nChains} chains)   flat = good mixing`,
  ];
  data.counts.forEach((chainCounts, chain) => {
    const bars = sparkline(chainCounts, { max: maxCount, charset });
    lines.push(`  ${color(`chain ${chain}`.padEnd(8), chain)} ${color(bars, chain)}`);
  });
  return `${lines.join("\n")}\n`;
}

/** Renders autocorrelation as one decaying line per chain over lag. */
export function renderAutocorrTerminal(data: AutocorrData, opts: TerminalOptions = {}): string {
  const charset = opts.charset ?? "unicode";
  const color = opts.color ?? identity;
  const totalWidth = opts.width ?? 72;
  const height = opts.height ?? 10;
  const plotW = Math.max(8, totalWidth - GUTTER - 2);

  let yMin = 0;
  for (const acf of data.chains) {
    for (const v of acf) if (v < yMin) yMin = v;
  }
  const canvas = new DotCanvas(plotW, height);
  const scaleX = linearScale([0, Math.max(1, data.maxLag)], [0, canvas.wDots - 1]);
  const scaleY = linearScale([yMin, 1], [canvas.hDots - 1, 0]);

  data.chains.forEach((acf, chain) => {
    for (let k = 1; k < acf.length; k++) {
      const y0 = acf[k - 1];
      const y1 = acf[k];
      if (y0 === undefined || y1 === undefined) continue;
      canvas.line(scaleX.map(k - 1), scaleY.map(y0), scaleX.map(k), scaleY.map(y1), chain);
    }
  });

  const header = `${data.variable}   autocorrelation (max lag ${data.maxLag}, ${data.nChains} chains)`;
  return axisFrame(canvas.rows(charset, color), {
    width: plotW,
    yMin,
    yMax: 1,
    xLeft: "0",
    xRight: String(data.maxLag),
    charset,
    header,
    gutter: GUTTER,
  });
}

/** Renders a pair (joint) scatter of two variables, colored by chain. */
export function renderPairTerminal(data: PairData, opts: TerminalOptions = {}): string {
  const charset = opts.charset ?? "unicode";
  const color = opts.color ?? identity;
  const totalWidth = opts.width ?? 72;
  const height = opts.height ?? 14;
  const plotW = Math.max(8, totalWidth - GUTTER - 2);

  const [xmin, xmax] = niceDomain(...extent(data.x));
  const [ymin, ymax] = niceDomain(...extent(data.y));
  const canvas = new DotCanvas(plotW, height);
  const scaleX = linearScale([xmin, xmax], [0, canvas.wDots - 1]);
  const scaleY = linearScale([ymin, ymax], [canvas.hDots - 1, 0]);

  for (let i = 0; i < data.x.length; i++) {
    const xv = data.x[i];
    const yv = data.y[i];
    if (xv === undefined || yv === undefined) continue;
    canvas.set(scaleX.map(xv), scaleY.map(yv), data.chain[i] ?? 0);
  }

  const header = `${data.xVar} vs ${data.yVar}   (${data.nChains} chains)`;
  return axisFrame(canvas.rows(charset, color), {
    width: plotW,
    yMin: ymin,
    yMax: ymax,
    xLeft: fmtNum(xmin),
    xRight: fmtNum(xmax),
    charset,
    header,
    gutter: GUTTER,
  });
}

/** Renders the energy diagnostic: marginal vs transition energy as two overlaid curves. */
export function renderEnergyTerminal(data: EnergyData, opts: TerminalOptions = {}): string {
  const charset = opts.charset ?? "unicode";
  const color = opts.color ?? identity;
  const totalWidth = opts.width ?? 72;
  const height = opts.height ?? 12;
  const plotW = Math.max(8, totalWidth - GUTTER - 2);

  const centers = data.marginal.map(
    (_, b) => ((data.edges[b] ?? 0) + (data.edges[b + 1] ?? 0)) / 2,
  );
  const maxC = Math.max(1, ...data.marginal, ...data.transition);
  const canvas = new DotCanvas(plotW, height);
  const scaleX = linearScale(
    [centers[0] ?? 0, centers[centers.length - 1] ?? 1],
    [0, canvas.wDots - 1],
  );
  const scaleY = linearScale([0, maxC], [canvas.hDots - 1, 0]);
  const draw = (counts: number[], series: number): void => {
    for (let b = 1; b < counts.length; b++) {
      canvas.line(
        scaleX.map(centers[b - 1] ?? 0),
        scaleY.map(counts[b - 1] ?? 0),
        scaleX.map(centers[b] ?? 0),
        scaleY.map(counts[b] ?? 0),
        series,
      );
    }
  };
  draw(data.marginal, 0);
  draw(data.transition, 1);

  const bfmi = meanBfmi(data.bfmi);
  const header = `energy   E-BFMI ${Number.isFinite(bfmi) ? bfmi.toFixed(2) : "n/a"}   (marginal vs transition)`;
  return axisFrame(canvas.rows(charset, color), {
    width: plotW,
    yMin: 0,
    yMax: maxC,
    xLeft: fmtNum(centers[0] ?? 0),
    xRight: fmtNum(centers[centers.length - 1] ?? 0),
    charset,
    header,
    gutter: GUTTER,
  });
}

/** Renders the empirical CDF (one monotone step per chain) as colored terminal text. */
export function renderEcdfTerminal(data: EcdfData, opts: TerminalOptions = {}): string {
  const charset = opts.charset ?? "unicode";
  const color = opts.color ?? identity;
  const totalWidth = opts.width ?? 72;
  const height = opts.height ?? 12;
  const plotW = Math.max(8, totalWidth - GUTTER - 2);

  const allX = data.series.flatMap((s) => s.x);
  const [xmin, xmax] = niceDomain(...extent(allX));
  const canvas = new DotCanvas(plotW, height);
  const scaleX = linearScale([xmin, xmax], [0, canvas.wDots - 1]);
  const scaleY = linearScale([0, 1], [canvas.hDots - 1, 0]);

  data.series.forEach((s, chain) => {
    for (let i = 1; i < s.x.length; i++) {
      const x0 = s.x[i - 1];
      const x1 = s.x[i];
      const y0 = s.y[i - 1];
      const y1 = s.y[i];
      if (x0 === undefined || x1 === undefined || y0 === undefined || y1 === undefined) continue;
      canvas.line(scaleX.map(x0), scaleY.map(y0), scaleX.map(x1), scaleY.map(y1), chain);
    }
  });

  const header = `${data.variable}   ECDF   (${data.nChains} chains)`;
  return axisFrame(canvas.rows(charset, color), {
    width: plotW,
    yMin: 0,
    yMax: 1,
    xLeft: fmtNum(xmin),
    xRight: fmtNum(xmax),
    charset,
    header,
    gutter: GUTTER,
  });
}

/** Renders the cumulative (running) mean of each chain as colored terminal text. */
export function renderCumulativeMeanTerminal(
  data: CumulativeMeanData,
  opts: TerminalOptions = {},
): string {
  const charset = opts.charset ?? "unicode";
  const color = opts.color ?? identity;
  const totalWidth = opts.width ?? 72;
  const height = opts.height ?? 12;
  const plotW = Math.max(8, totalWidth - GUTTER - 2);

  const [rawMin, rawMax] = extent(data.chains.flat());
  const [ymin, ymax] = niceDomain(rawMin, rawMax);
  const maxLen = data.iterations.length;
  const canvas = new DotCanvas(plotW, height);
  const scaleX = linearScale([1, Math.max(2, maxLen)], [0, canvas.wDots - 1]);
  const scaleY = linearScale([ymin, ymax], [canvas.hDots - 1, 0]);

  data.chains.forEach((vals, chain) => {
    for (let i = 1; i < vals.length; i++) {
      const y0 = vals[i - 1];
      const y1 = vals[i];
      if (y0 === undefined || y1 === undefined) continue;
      canvas.line(scaleX.map(i), scaleY.map(y0), scaleX.map(i + 1), scaleY.map(y1), chain);
    }
  });

  const header = `${data.variable}   cumulative mean   (${data.nChains} chains)`;
  return axisFrame(canvas.rows(charset, color), {
    width: plotW,
    yMin: ymin,
    yMax: ymax,
    xLeft: "1",
    xRight: String(maxLen),
    charset,
    header,
    gutter: GUTTER,
  });
}

/** Renders running basic R-hat as a single line over increasing prefix length. */
export function renderRunningRhatTerminal(
  data: RunningRhatData,
  opts: TerminalOptions = {},
): string {
  const charset = opts.charset ?? "unicode";
  const color = opts.color ?? identity;
  const totalWidth = opts.width ?? 72;
  const height = opts.height ?? 10;
  const plotW = Math.max(8, totalWidth - GUTTER - 2);

  if (data.iterations.length === 0) {
    return `${data.variable}   running R-hat   (needs >= 2 chains and >= 6 draws)\n`;
  }

  const [rawMin, rawMax] = extent([...data.rhat, 1, 1.05]);
  const [ymin, ymax] = niceDomain(rawMin, rawMax);
  const xLo = data.iterations[0] ?? 0;
  const xHi = data.iterations[data.iterations.length - 1] ?? 1;
  const canvas = new DotCanvas(plotW, height);
  const scaleX = linearScale([xLo, Math.max(xLo + 1, xHi)], [0, canvas.wDots - 1]);
  const scaleY = linearScale([ymin, ymax], [canvas.hDots - 1, 0]);

  for (let i = 1; i < data.iterations.length; i++) {
    const x0 = data.iterations[i - 1];
    const x1 = data.iterations[i];
    const y0 = data.rhat[i - 1];
    const y1 = data.rhat[i];
    if (x0 === undefined || x1 === undefined || y0 === undefined || y1 === undefined) continue;
    canvas.line(scaleX.map(x0), scaleY.map(y0), scaleX.map(x1), scaleY.map(y1), 0);
  }

  const header = `${data.variable}   running basic R-hat`;
  return axisFrame(canvas.rows(charset, color), {
    width: plotW,
    yMin: ymin,
    yMax: ymax,
    xLeft: String(xLo),
    xRight: String(xHi),
    charset,
    header,
    gutter: GUTTER,
  });
}

/** Shared interval-row terminal layout (q5..q95 thin, q25..q75 thick, median dot). */
function renderIntervalRowsTerminal(
  rows: IntervalRow[],
  title: string,
  opts: TerminalOptions,
): string {
  const charset = opts.charset ?? "unicode";
  const color = opts.color ?? identity;
  const totalWidth = opts.width ?? 72;
  if (rows.length === 0) return `${title}\n(no data)\n`;

  const thinGlyph = charset === "ascii" ? "-" : "─";
  const thickGlyph = charset === "ascii" ? "=" : "━";
  const medianGlyph = charset === "ascii" ? "*" : "●";

  const labelW = Math.min(20, Math.max(8, ...rows.map((r) => r.label.length)));
  const annot = rows.map((r) => `${fmtNum(r.q50)}  [${fmtNum(r.q5)}, ${fmtNum(r.q95)}]`);
  const annotW = Math.max(...annot.map((a) => a.length));
  const axisW = Math.max(12, totalWidth - labelW - annotW - 6);

  let xmin = Number.POSITIVE_INFINITY;
  let xmax = Number.NEGATIVE_INFINITY;
  for (const r of rows) {
    xmin = Math.min(xmin, r.q5);
    xmax = Math.max(xmax, r.q95);
  }
  if (!Number.isFinite(xmin) || !Number.isFinite(xmax) || xmin === xmax) {
    xmin = (xmin || 0) - 1;
    xmax = (xmax || 0) + 1;
  }
  const scaleX = linearScale([xmin, xmax], [0, axisW - 1]);
  const col = (v: number): number => Math.max(0, Math.min(axisW - 1, Math.round(scaleX.map(v))));

  const lines: string[] = [title];
  rows.forEach((r, i) => {
    const cells = new Array<string>(axisW).fill(" ");
    for (let c = col(r.q5); c <= col(r.q95); c++) cells[c] = thinGlyph;
    for (let c = col(r.q25); c <= col(r.q75); c++) cells[c] = thickGlyph;
    cells[col(r.q50)] = medianGlyph;
    const label = r.label.length > labelW ? `${r.label.slice(0, labelW - 1)}…` : r.label;
    lines.push(`${color(label.padEnd(labelW), i)}  ${color(cells.join(""), i)}  ${annot[i] ?? ""}`);
  });
  return `${lines.join("\n")}\n`;
}

/** Per-chain credible intervals for one variable as terminal text. */
export function renderChainIntervalsTerminal(
  data: ChainIntervalsData,
  opts: TerminalOptions = {},
): string {
  return renderIntervalRowsTerminal(data.rows, `chain intervals: ${data.variable}`, opts);
}

/** Pooled credible intervals across variables as terminal text. */
export function renderChainIntervalsAllTerminal(
  data: ChainIntervalsAllData,
  opts: TerminalOptions = {},
): string {
  return renderIntervalRowsTerminal(data.rows, "chain intervals (all variables)", opts);
}

/** Renders each chain's peak-normalized KDE band as a sparkline row. */
export function renderViolinTerminal(data: ViolinData, opts: TerminalOptions = {}): string {
  const charset = opts.charset ?? "unicode";
  const color = opts.color ?? identity;
  if (data.rows.length === 0) return `${data.variable}  violin\n(no data)\n`;

  const labelW = Math.max(8, ...data.rows.map((r) => r.label.length));
  const lines: string[] = [`${data.variable}   violin   (${data.rows.length} chains)`];
  data.rows.forEach((r, i) => {
    const bars = sparkline(r.density, { max: 1, charset });
    lines.push(`  ${color(r.label.padEnd(labelW), i)} ${color(bars, i)}`);
  });
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
  const scaleX = linearScale([xmin, xmax], [0, axisW - 1]);
  const col = (v: number): number => Math.max(0, Math.min(axisW - 1, Math.round(scaleX.map(v))));

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

const DASH = "-";

function fixed3(v: number): string {
  return Number.isFinite(v) ? v.toFixed(3) : DASH;
}
function fixed4(v: number): string {
  return Number.isFinite(v) ? v.toFixed(4) : DASH;
}
function rounded(v: number): string {
  return Number.isFinite(v) ? String(Math.round(v)) : DASH;
}

/** Renders the per-variable summary table as a fixed-width ASCII table. */
export function renderSummaryTableTerminal(
  data: SummaryTableData,
  opts: TerminalOptions = {},
): string {
  const warn = opts.warn ?? identity;
  if (data.rows.length === 0) return "(no variables)\n";

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
    "BulkESS",
    "TailESS",
    "R-hat",
    "SplitRhat",
    "GewekeZ",
    "HDI90",
  ];

  // Each cell carries its plain text plus an optional traffic-light flag so the
  // column width is measured on the uncolored text.
  const cellsFor = (r: SummaryTableData["rows"][number]): { text: string; warn: boolean }[] => {
    const hdi = `[${fixed3(r.hdi90[0])}, ${fixed3(r.hdi90[1])}]`;
    const rhatBad = Number.isFinite(r.rhat) && r.rhat >= 1.05;
    const splitBad = Number.isFinite(r.splitRhat) && r.splitRhat >= 1.05;
    const gewekeBad = Number.isFinite(r.gewekeZ) && Math.abs(r.gewekeZ) >= 1.96;
    const essBad = (v: number) => Number.isFinite(v) && v <= 400;
    return [
      { text: r.variable, warn: false },
      { text: fixed4(r.mean), warn: false },
      { text: fixed4(r.std), warn: false },
      { text: fixed4(r.mcse), warn: false },
      { text: fixed4(r.q5), warn: false },
      { text: fixed4(r.q25), warn: false },
      { text: fixed4(r.q50), warn: false },
      { text: fixed4(r.q75), warn: false },
      { text: fixed4(r.q95), warn: false },
      { text: rounded(r.ess), warn: essBad(r.ess) },
      { text: rounded(r.essBulk), warn: essBad(r.essBulk) },
      { text: rounded(r.essTail), warn: essBad(r.essTail) },
      { text: fixed3(r.rhat), warn: rhatBad },
      { text: fixed3(r.splitRhat), warn: splitBad },
      { text: fixed3(r.gewekeZ), warn: gewekeBad },
      { text: hdi, warn: false },
    ];
  };

  const rows = data.rows.map(cellsFor);
  const widths = headers.map((h, c) =>
    Math.max(h.length, ...rows.map((cells) => (cells[c]?.text ?? "").length)),
  );

  const pad = (text: string, c: number, left: boolean): string => {
    const w = widths[c] ?? text.length;
    return left ? text.padStart(w) : text.padEnd(w);
  };

  const lines: string[] = [];
  lines.push(headers.map((h, c) => pad(h, c, c !== 0)).join("  "));
  for (const cells of rows) {
    const line = cells
      .map((cell, c) => {
        const padded = pad(cell.text, c, c !== 0);
        return cell.warn ? warn(padded) : padded;
      })
      .join("  ");
    lines.push(line);
  }
  return `${lines.join("\n")}\n`;
}

/** Buckets a 0..1 score into a good/warn/poor status (matches the heatmap tooltip). */
function statusBucket(score: number): 0 | 1 | 2 {
  if (score < 0.35) return 0;
  if (score < 0.65) return 1;
  return 2;
}

/** Renders the diagnostics heatmap as a metric grid with traffic-light coloring. */
export function renderDiagnosticsHeatmapTerminal(
  data: DiagnosticsHeatmapData,
  opts: TerminalOptions = {},
): string {
  const warn = opts.warn ?? identity;
  if (data.rows.length === 0) return "(no variables)\n";

  const labelW = Math.max("parameter".length, ...data.rows.map((r) => r.variable.length));
  const colW = data.metrics.map((m, c) =>
    Math.max(m.length, ...data.rows.map((r) => (r.cells[c]?.text ?? "").length)),
  );

  const header = [
    "parameter".padEnd(labelW),
    ...data.metrics.map((m, c) => m.padStart(colW[c] ?? m.length)),
  ].join("  ");

  const lines: string[] = [header];
  for (const row of data.rows) {
    const cells = data.metrics.map((_, c) => {
      const cell = row.cells[c];
      const text = (cell?.text ?? DASH).padStart(colW[c] ?? 0);
      // Color only poor (red) cells via `warn`; good/warning stay plain so the
      // table reads cleanly on terminals without a green/amber ANSI palette.
      return cell && statusBucket(cell.score) === 2 ? warn(text) : text;
    });
    lines.push([row.variable.padEnd(labelW), ...cells].join("  "));
  }
  return `${lines.join("\n")}\n`;
}

/** Renders a SPLOM as a compact Pearson-correlation matrix (diagonal 1.00). */
export function renderSplomTerminal(data: SplomData, opts: TerminalOptions = {}): string {
  const color = opts.color ?? identity;
  const vars = data.vars;
  if (vars.length === 0) return "(no variables)\n";

  const pearsonAt = (row: number, col: number): number | undefined =>
    data.corr.find((c) => c.row === Math.min(row, col) && c.col === Math.max(row, col))?.pearson;

  const labelW = Math.max(4, ...vars.map((v) => v.length));
  const colW = Math.max(5, ...vars.map((v) => v.length));
  const pad = (text: string): string => text.padStart(colW);

  const header = [" ".repeat(labelW), ...vars.map(pad)].join("  ");
  const lines: string[] = [`pairs (${vars.length} vars, ${data.nChains} chains)`, header];
  for (let row = 0; row < vars.length; row++) {
    const cells = vars.map((_, col) => {
      if (row === col) return pad("1.00");
      const r = pearsonAt(row, col);
      return pad(r === undefined ? "-" : r.toFixed(2));
    });
    lines.push([color((vars[row] ?? "").padEnd(labelW), row), ...cells].join("  "));
  }
  return `${lines.join("\n")}\n`;
}
