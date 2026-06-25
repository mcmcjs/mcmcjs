import { extent, niceDomain } from "@mcmcjs/charts";
import { chainView, type Samples } from "@mcmcjs/core";
import {
  autocorr,
  diagnoseChains,
  essIMSE,
  geweke,
  isConverged,
  mean,
  pearson,
  quantiles,
  rhat,
  spearman,
  splitRhat,
  stdev,
} from "@mcmcjs/diagnostics";
import {
  type AutocorrData,
  type ChainIntervalsAllData,
  type ChainIntervalsData,
  type CumulativeMeanData,
  type DensityData,
  type DiagnosticsHeatmapData,
  type EcdfData,
  type EnergyData,
  type ForestData,
  type ForestRow,
  HEATMAP_METRICS,
  type HeatmapCell,
  type HeatmapRow,
  type HistogramData,
  type IntervalRow,
  type PairData,
  type ParallelCoordsBound,
  type ParallelCoordsData,
  type ParallelCoordsLine,
  type RankData,
  type RunningRhatData,
  type SplomCell,
  type SplomCorr,
  type SplomData,
  type SplomDiagonal,
  type SummaryRow,
  type SummaryTableData,
  type TraceData,
  type ViolinData,
  type ViolinRow,
} from "./types";

const INV_SQRT_2PI = 1 / Math.sqrt(2 * Math.PI);

/** Silverman rule-of-thumb bandwidth; 0 when the sample has no spread. */
export function bandwidth(chain: Float64Array): number {
  const n = chain.length;
  if (n < 2) return 0;
  const sd = stdev(chain);
  const q = quantiles(chain);
  const iqr = q.q75 - q.q25;
  const sigma = iqr > 0 ? Math.min(sd, iqr / 1.349) : sd;
  return sigma > 0 ? 1.06 * sigma * n ** (-1 / 5) : 0;
}

/** Gaussian KDE of `values` evaluated on `grid` with bandwidth `h` (zeros when h <= 0). */
export function gaussianKde(values: Float64Array, grid: number[], h: number): number[] {
  if (h <= 0) return new Array<number>(grid.length).fill(0);
  const norm = 1 / (values.length * h);
  return grid.map((g) => {
    let sum = 0;
    for (const xi of values) {
      const z = (g - xi) / h;
      sum += Math.exp(-0.5 * z * z);
    }
    return sum * norm * INV_SQRT_2PI;
  });
}

/** One variable's draws split per chain, as no-copy views over the Samples buffer. */
export function chainsOf(samples: Samples, variable: string): Float64Array[] {
  return Array.from({ length: samples.nChains }, (_, c) => chainView(samples, variable, c));
}

/** Trace data for one variable: each chain's draw sequence plus R-hat and bulk ESS. */
export function traceData(samples: Samples, variable: string): TraceData {
  const chains = chainsOf(samples, variable);
  const d = diagnoseChains(chains);
  return {
    kind: "trace",
    variable,
    nChains: samples.nChains,
    nDraws: samples.nDraws,
    chains: chains.map((c) => Array.from(c)),
    rhat: d.rhat,
    essBulk: d.essBulk,
  };
}

/** Kernel-density data for one variable: a Gaussian KDE curve per chain on a shared grid. */
export function densityData(
  samples: Samples,
  variable: string,
  opts: { gridSize?: number } = {},
): DensityData {
  const gridSize = Math.max(2, opts.gridSize ?? 256);
  const chains = chainsOf(samples, variable);
  const pooled = samples.draws.get(variable) ?? chainView(samples, variable, 0);
  const [lo, hi] = niceDomain(...extent(pooled));
  const step = (hi - lo) / (gridSize - 1);
  const x = Array.from({ length: gridSize }, (_, k) => lo + k * step);

  const curves = chains.map((chain) => gaussianKde(chain, x, bandwidth(chain)));

  return { kind: "density", variable, nChains: samples.nChains, x, chains: curves };
}

/** Pooled histogram for one variable; bin count via Freedman-Diaconis unless `bins` is given. */
export function histogramData(
  samples: Samples,
  variable: string,
  opts: { bins?: number } = {},
): HistogramData {
  const pooled = samples.draws.get(variable) ?? chainView(samples, variable, 0);
  const values = Array.from(pooled).filter(Number.isFinite);
  const total = values.length;
  const [lo, hi] = extent(values);

  let bins = opts.bins;
  if (!bins || bins < 1) {
    const q = quantiles(pooled);
    const iqr = q.q75 - q.q25;
    const fd = iqr > 0 && total > 0 ? 2 * iqr * total ** (-1 / 3) : 0;
    bins = fd > 0 ? Math.ceil((hi - lo) / fd) : Math.ceil(Math.sqrt(Math.max(1, total)));
    bins = Math.max(1, Math.min(120, bins));
  }

  const width = hi > lo ? (hi - lo) / bins : 1;
  const counts = new Array<number>(bins).fill(0);
  for (const v of values) {
    const b = Math.min(bins - 1, Math.max(0, Math.floor((v - lo) / width)));
    counts[b] = (counts[b] ?? 0) + 1;
  }
  const binEdges = Array.from({ length: bins + 1 }, (_, i) => lo + i * width);
  return { kind: "histogram", variable, binEdges, counts, total };
}

/** Rank plot data: per-chain counts of pooled average-ranks over `bins` bins. */
export function rankData(
  samples: Samples,
  variable: string,
  opts: { bins?: number } = {},
): RankData {
  const bins = Math.max(1, opts.bins ?? 20);
  const { nChains, nDraws } = samples;
  const pooled = samples.draws.get(variable) ?? chainView(samples, variable, 0);
  const n = pooled.length;

  // Average ranks (1-based); tied values share the mean of their rank block.
  const order = Array.from({ length: n }, (_, i) => i).sort(
    (a, b) => (pooled[a] as number) - (pooled[b] as number),
  );
  const ranks = new Float64Array(n);
  let i = 0;
  while (i < n) {
    let j = i;
    while (j + 1 < n && pooled[order[j + 1] as number] === pooled[order[i] as number]) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) ranks[order[k] as number] = avg;
    i = j + 1;
  }

  const counts = Array.from({ length: nChains }, () => new Array<number>(bins).fill(0));
  for (let idx = 0; idx < n; idx++) {
    const chain = Math.min(nChains - 1, Math.floor(idx / nDraws));
    const b = Math.min(bins - 1, Math.floor((((ranks[idx] as number) - 1) / n) * bins));
    const row = counts[chain] as number[];
    row[b] = (row[b] ?? 0) + 1;
  }
  return { kind: "rank", variable, nChains, bins, counts, expected: nDraws / bins };
}

/** Autocorrelation data: the ACF (lag 0..maxLag) of each chain. */
export function autocorrData(
  samples: Samples,
  variable: string,
  opts: { maxLag?: number } = {},
): AutocorrData {
  const maxLag = Math.max(1, opts.maxLag ?? 40);
  const chains = chainsOf(samples, variable).map((c) => autocorr(c, maxLag));
  const longest = Math.max(0, ...chains.map((a) => a.length));
  const lags = Array.from({ length: longest }, (_, k) => k);
  return { kind: "autocorr", variable, nChains: samples.nChains, maxLag, lags, chains };
}

/** Per-draw divergence flags (chain-major), from the sampler stats; all false when absent. */
function divergingFlags(samples: Samples): boolean[] {
  const series = samples.sampleStats.get("numerical_error") ?? samples.sampleStats.get("diverging");
  const n = samples.nChains * samples.nDraws;
  if (!series) return new Array<boolean>(n).fill(false);
  return Array.from({ length: n }, (_, i) => (series[i] ?? 0) !== 0);
}

/**
 * Pair plot data: pooled joint draws of two variables, labeled by chain and divergence.
 * With `opts.colorVar`, a parallel per-point value of a third variable is attached so a
 * renderer can shade points through a continuous colormap; without it, the result is
 * byte-for-byte the color-by-chain object (no color fields).
 */
export function pairData(
  samples: Samples,
  xVar: string,
  yVar: string,
  opts: { colorVar?: string } = {},
): PairData {
  const xs = samples.draws.get(xVar) ?? chainView(samples, xVar, 0);
  const ys = samples.draws.get(yVar) ?? chainView(samples, yVar, 0);
  const cs = opts.colorVar
    ? (samples.draws.get(opts.colorVar) ?? chainView(samples, opts.colorVar, 0))
    : undefined;
  const div = divergingFlags(samples);
  const n = cs ? Math.min(xs.length, ys.length, cs.length) : Math.min(xs.length, ys.length);
  const x: number[] = [];
  const y: number[] = [];
  const chain: number[] = [];
  const diverging: boolean[] = [];
  const color: number[] | undefined = cs ? [] : undefined;
  for (let i = 0; i < n; i++) {
    x.push(xs[i] as number);
    y.push(ys[i] as number);
    chain.push(Math.floor(i / samples.nDraws));
    diverging.push(div[i] ?? false);
    if (color && cs) color.push(cs[i] ?? Number.NaN);
  }

  const base: PairData = {
    kind: "pair",
    xVar,
    yVar,
    nChains: samples.nChains,
    x,
    y,
    chain,
    diverging,
  };
  if (!color || !opts.colorVar) return base;

  let colorMin = Number.POSITIVE_INFINITY;
  let colorMax = Number.NEGATIVE_INFINITY;
  for (const v of color) {
    if (!Number.isFinite(v)) continue;
    if (v < colorMin) colorMin = v;
    if (v > colorMax) colorMax = v;
  }
  if (!Number.isFinite(colorMin) || !Number.isFinite(colorMax)) {
    colorMin = 0;
    colorMax = 1;
  }
  return { ...base, colorVar: opts.colorVar, color, colorMin, colorMax };
}

/**
 * Energy diagnostic data (HMC/NUTS): the centered marginal-energy distribution and the
 * energy-transition distribution on shared bins, plus per-chain E-BFMI. Throws when the
 * sampler did not record an energy statistic.
 */
export function energyData(samples: Samples, opts: { bins?: number } = {}): EnergyData {
  const energy = samples.sampleStats.get("hamiltonian_energy") ?? samples.sampleStats.get("energy");
  if (!energy) {
    throw new Error("energy plot needs the 'hamiltonian_energy' sampler statistic");
  }
  const { nChains, nDraws } = samples;
  let total = 0;
  for (const v of energy) total += v;
  const mean = total / energy.length;

  const marginalVals: number[] = [];
  const transitionVals: number[] = [];
  const bfmi: number[] = [];
  for (let c = 0; c < nChains; c++) {
    let chainSum = 0;
    for (let i = 0; i < nDraws; i++) chainSum += energy[c * nDraws + i] as number;
    const chainMean = chainSum / nDraws;
    let num = 0;
    let den = 0;
    for (let i = 0; i < nDraws; i++) {
      const e = energy[c * nDraws + i] as number;
      marginalVals.push(e - mean);
      den += (e - chainMean) ** 2;
      if (i > 0) {
        const d = e - (energy[c * nDraws + i - 1] as number);
        transitionVals.push(d);
        num += d * d;
      }
    }
    bfmi.push(den > 0 ? num / den : Number.NaN);
  }

  const bins = Math.max(1, opts.bins ?? 30);
  const [lo, hi] = extent([...marginalVals, ...transitionVals]);
  const width = hi > lo ? (hi - lo) / bins : 1;
  const edges = Array.from({ length: bins + 1 }, (_, i) => lo + i * width);
  const binOf = (vals: number[]): number[] => {
    const counts = new Array<number>(bins).fill(0);
    for (const v of vals) {
      const b = Math.min(bins - 1, Math.max(0, Math.floor((v - lo) / width)));
      counts[b] = (counts[b] ?? 0) + 1;
    }
    return counts;
  };
  return {
    kind: "energy",
    edges,
    marginal: binOf(marginalVals),
    transition: binOf(transitionVals),
    bfmi,
  };
}

/** Forest data: a point estimate, HDI, and IQR per variable, sharing an x-axis. */
export function forestData(
  samples: Samples,
  opts: { variables?: readonly string[]; hdiProb?: number } = {},
): ForestData {
  const hdiProb = opts.hdiProb ?? 0.94;
  const variables = opts.variables ?? samples.variables;
  const rows: ForestRow[] = variables.map((variable) => {
    const chains = chainsOf(samples, variable);
    const d = diagnoseChains(chains, hdiProb);
    const pooled = samples.draws.get(variable) ?? chainView(samples, variable, 0);
    const q = quantiles(pooled);
    return {
      variable,
      mean: d.mean,
      hdi: d.hdi,
      iqr: [q.q25, q.q75],
      rhat: d.rhat,
      essBulk: d.essBulk,
      converged: isConverged(d),
    };
  });
  return { kind: "forest", hdiProb, rows };
}

/** Empirical CDF per chain: sorted draws with cumulative probability `(i+1)/n`. */
export function ecdfData(samples: Samples, variable: string): EcdfData {
  const series = chainsOf(samples, variable).map((c, chain) => {
    const sorted = Array.from(c).sort((a, b) => a - b);
    const n = sorted.length;
    const y = sorted.map((_, i) => (i + 1) / n);
    return { chain, x: sorted, y };
  });
  return { kind: "ecdf", variable, nChains: samples.nChains, series };
}

/** Running mean per chain over shared 1-based iterations. */
export function cumulativeMeanData(samples: Samples, variable: string): CumulativeMeanData {
  const chains = chainsOf(samples, variable);
  const maxLen = Math.max(0, ...chains.map((c) => c.length));
  const iterations = Array.from({ length: maxLen }, (_, i) => i + 1);
  const out = chains.map((c) => {
    const v = new Array<number>(c.length);
    let sum = 0;
    for (let j = 0; j < c.length; j++) {
      sum += c[j] ?? 0;
      v[j] = sum / (j + 1);
    }
    return v;
  });
  return { kind: "cumulative-mean", variable, nChains: samples.nChains, iterations, chains: out };
}

/** Basic split-R-hat over an increasing prefix of draws (needs >= 2 chains, >= 6 draws). */
export function runningRhatData(samples: Samples, variable: string): RunningRhatData {
  const nChains = samples.nChains;
  const chains = chainsOf(samples, variable).filter((c) => c.length > 0);
  if (chains.length < 2) {
    return { kind: "running-rhat", variable, nChains, iterations: [], rhat: [] };
  }
  const minLen = Math.min(...chains.map((c) => c.length));
  const step = Math.max(1, Math.floor(minLen / 200));
  const startAt = Math.max(6, step);
  const iterations: number[] = [];
  const rhats: number[] = [];
  for (let n = startAt; n <= minLen; n += step) {
    const r = rhat(
      chains.map((c) => c.slice(0, n)),
      "basic",
    );
    if (Number.isFinite(r)) {
      iterations.push(n);
      rhats.push(r);
    }
  }
  return { kind: "running-rhat", variable, nChains, iterations, rhat: rhats };
}

function intervalRow(label: string, draws: Float64Array): IntervalRow {
  const q = quantiles(draws);
  return { label, q5: q.q5, q25: q.q25, q50: q.q50, q75: q.q75, q95: q.q95 };
}

/** Per-chain credible intervals (q5..q95, q25..q75, median) for one variable. */
export function chainIntervalsData(samples: Samples, variable: string): ChainIntervalsData {
  const rows: IntervalRow[] = [];
  chainsOf(samples, variable).forEach((chain, i) => {
    if (chain.length === 0) return;
    rows.push(intervalRow(`chain ${i + 1}`, chain));
  });
  return { kind: "chain-intervals", variable, rows };
}

/** Pooled credible intervals, one row per variable (median is the point estimate). */
export function chainIntervalsAllData(
  samples: Samples,
  opts: { variables?: readonly string[] } = {},
): ChainIntervalsAllData {
  const variables = opts.variables ?? samples.variables;
  const rows: IntervalRow[] = [];
  for (const v of variables) {
    const pooled = samples.draws.get(v) ?? chainView(samples, v, 0);
    if (pooled.length === 0) continue;
    rows.push(intervalRow(v, pooled));
  }
  return { kind: "chain-intervals-all", rows };
}

function violinRow(label: string, values: Float64Array, gridSize: number): ViolinRow {
  const [mn, mx] = extent(values);
  const pad = (mx - mn) * 0.1 || 1;
  const lo = mn - pad;
  const hi = mx + pad;
  const step = (hi - lo) / (gridSize - 1);
  const x = Array.from({ length: gridSize }, (_, k) => lo + k * step);
  let density = gaussianKde(values, x, bandwidth(values));
  const peak = Math.max(0, ...density);
  if (peak > 0) density = density.map((d) => d / peak);
  const q = quantiles(values);
  return {
    label,
    x,
    density,
    mean: mean(values),
    stdev: stdev(values),
    q5: q.q5,
    q50: q.q50,
    q95: q.q95,
  };
}

/** Violin data: a peak-normalized KDE band per chain (reuses the density bandwidth). */
export function violinData(
  samples: Samples,
  variable: string,
  opts: { gridSize?: number } = {},
): ViolinData {
  const gridSize = Math.max(2, opts.gridSize ?? 256);
  const rows = chainsOf(samples, variable).map((chain, i) =>
    violinRow(`chain ${i + 1}`, chain, gridSize),
  );
  return { kind: "violin", variable, gridSize, rows };
}

/** The full per-variable diagnostic row used by the summary table and heatmap. */
function summaryRow(samples: Samples, variable: string, hdiProb: number): SummaryRow {
  const chains = chainsOf(samples, variable);
  const pooled = samples.draws.get(variable) ?? chainView(samples, variable, 0);
  const q = quantiles(pooled);
  const d = diagnoseChains(chains, hdiProb);
  let ess = 0;
  for (const c of chains) ess += essIMSE(c).ess;
  return {
    variable,
    mean: mean(pooled),
    std: stdev(pooled),
    mcse: d.mcseMean,
    q5: q.q5,
    q25: q.q25,
    q50: q.q50,
    q75: q.q75,
    q95: q.q95,
    ess,
    essBulk: d.essBulk,
    essTail: d.essTail,
    rhat: d.rhat,
    splitRhat: splitRhat(chains),
    gewekeZ: geweke(pooled).z,
    hdi90: d.hdi,
  };
}

/**
 * Summary table data: the full diagnostic row per variable (mean, std, MCSE,
 * quantiles, ESS variants, R-hats, Geweke z, and the HDI). The HDI defaults to a
 * 0.9 credible mass to match the table convention.
 */
export function summaryTableData(
  samples: Samples,
  opts: { variables?: readonly string[]; hdiProb?: number } = {},
): SummaryTableData {
  const hdiProb = opts.hdiProb ?? 0.9;
  const variables = opts.variables ?? samples.variables;
  return { kind: "summary-table", rows: variables.map((v) => summaryRow(samples, v, hdiProb)) };
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Maps an upper-is-bad metric to [0, 1]: <= good is 0, >= bad is 1; 0.5 when undefined. */
function scoreUpper(value: number, good: number, bad: number): number {
  return !Number.isFinite(value) ? 0.5 : clamp01((value - good) / (bad - good));
}

/** Maps a higher-is-better metric to [0, 1]: >= good is 0, <= bad is 1; 0.5 when undefined. */
function scoreLower(value: number, good: number, bad: number): number {
  return !Number.isFinite(value) ? 0.5 : clamp01((good - value) / (good - bad));
}

/** Piecewise-linear green-700 -> amber-700 -> red-700 ramp over a 0..1 score. */
const CELL_RAMP: [number, [number, number, number]][] = [
  [0, [21, 128, 61]],
  [0.5, [180, 83, 9]],
  [1, [185, 28, 28]],
];

function lerpRgb(t: number): [number, number, number] {
  const tc = clamp01(t);
  for (let i = 1; i < CELL_RAMP.length; i++) {
    const stop = CELL_RAMP[i];
    const prev = CELL_RAMP[i - 1];
    if (!stop || !prev) continue;
    const [t1, c1] = stop;
    if (tc <= t1) {
      const [t0, c0] = prev;
      const u = (tc - t0) / (t1 - t0 || 1);
      return [
        Math.round((c0[0] ?? 0) + ((c1[0] ?? 0) - (c0[0] ?? 0)) * u),
        Math.round((c0[1] ?? 0) + ((c1[1] ?? 0) - (c0[1] ?? 0)) * u),
        Math.round((c0[2] ?? 0) + ((c1[2] ?? 0) - (c0[2] ?? 0)) * u),
      ];
    }
  }
  const last = CELL_RAMP[CELL_RAMP.length - 1];
  const rgb = last ? last[1] : [0, 0, 0];
  return [rgb[0] ?? 0, rgb[1] ?? 0, rgb[2] ?? 0];
}

const EM_DASH = "—";

/** Format a metric value to 3 decimals, or an em dash when non-finite. */
function fmt3(v: number): string {
  return Number.isFinite(v) ? v.toFixed(3) : EM_DASH;
}

/** Format a metric value as a rounded integer, or an em dash when non-finite. */
function integer(v: number): string {
  return Number.isFinite(v) ? Math.round(v).toString() : EM_DASH;
}

function heatmapCells(row: SummaryRow, nDraws: number): HeatmapCell[] {
  const essPerDraw = nDraws > 0 ? row.ess / nDraws : Number.NaN;
  const mcseRatio = row.std === 0 ? 0 : row.mcse / row.std;
  const gewekeAbs = Math.abs(row.gewekeZ);
  const specs: { metric: string; value: number; text: string; score: number }[] = [
    {
      metric: "R-hat",
      value: row.rhat,
      text: fmt3(row.rhat),
      score: scoreUpper(row.rhat, 1.01, 1.1),
    },
    {
      metric: "Split R-hat",
      value: row.splitRhat,
      text: fmt3(row.splitRhat),
      score: scoreUpper(row.splitRhat, 1.01, 1.1),
    },
    {
      metric: "ESS / draw",
      value: essPerDraw,
      text: fmt3(essPerDraw),
      score: scoreLower(essPerDraw, 0.25, 0.05),
    },
    {
      metric: "Bulk ESS",
      value: row.essBulk,
      text: integer(row.essBulk),
      score: scoreLower(row.essBulk, 400, 100),
    },
    {
      metric: "Tail ESS",
      value: row.essTail,
      text: integer(row.essTail),
      score: scoreLower(row.essTail, 400, 100),
    },
    {
      metric: "MCSE / sd",
      value: mcseRatio,
      text: row.std === 0 ? "0.000" : fmt3(mcseRatio),
      score: scoreUpper(mcseRatio, 0.02, 0.1),
    },
    {
      metric: "|Geweke z|",
      value: gewekeAbs,
      text: fmt3(gewekeAbs),
      score: scoreUpper(gewekeAbs, 1.96, 3.0),
    },
  ];
  return specs.map((s) => ({ ...s, rgb: lerpRgb(s.score) }));
}

/**
 * Diagnostics heatmap data: one row per variable, each with a pre-scored,
 * pre-colored cell per metric (R-hat, Split R-hat, ESS/draw, Bulk ESS, Tail ESS,
 * MCSE/sd, |Geweke z|). The HDI credible mass defaults to 0.9 to match the table.
 */
export function diagnosticsHeatmapData(
  samples: Samples,
  opts: { variables?: readonly string[]; hdiProb?: number } = {},
): DiagnosticsHeatmapData {
  const hdiProb = opts.hdiProb ?? 0.9;
  const variables = opts.variables ?? samples.variables;
  const rows: HeatmapRow[] = variables.map((variable) => {
    const row = summaryRow(samples, variable, hdiProb);
    const pooled = samples.draws.get(variable) ?? chainView(samples, variable, 0);
    return { variable, cells: heatmapCells(row, pooled.length) };
  });
  return { kind: "diagnostics-heatmap", metrics: [...HEATMAP_METRICS], rows };
}

/** One variable's peak-normalized 1-D KDE on a padded grid (reuses the density bandwidth). */
function splomDiagonal(variable: string, pooled: Float64Array, gridSize: number): SplomDiagonal {
  const [mn, mx] = extent(pooled);
  const pad = (mx - mn) * 0.1 || 1;
  const lo = mn - pad;
  const hi = mx + pad;
  const step = (hi - lo) / (gridSize - 1);
  const x = Array.from({ length: gridSize }, (_, k) => lo + k * step);
  let density = gaussianKde(pooled, x, bandwidth(pooled));
  const peak = Math.max(0, ...density);
  if (peak > 0) density = density.map((d) => d / peak);
  return { variable, x, density };
}

/**
 * Scatter-plot matrix data over `vars` (default: the first `min(6, variables.length)`). The
 * diagonal holds each variable's 1-D KDE, the upper triangle its pairwise Pearson/Spearman
 * correlations over pooled draws, and the lower triangle the joint draws subsampled to a cap.
 */
export function splomData(
  samples: Samples,
  vars?: string[],
  opts: { maxVars?: number } = {},
): SplomData {
  const maxVars = Math.max(1, opts.maxVars ?? 6);
  const all = vars ?? [...samples.variables];
  const used = all.slice(0, Math.min(maxVars, all.length));
  const gridSize = 128;
  const cap = 3000;

  const pooledOf = used.map((v) => samples.draws.get(v) ?? chainView(samples, v, 0));

  const diagonals: SplomDiagonal[] = used.map((v, i) =>
    splomDiagonal(v, pooledOf[i] ?? new Float64Array(0), gridSize),
  );

  const corr: SplomCorr[] = [];
  const cells: SplomCell[] = [];
  for (let row = 0; row < used.length; row++) {
    for (let col = 0; col < used.length; col++) {
      const xs = pooledOf[col] ?? new Float64Array(0);
      const ys = pooledOf[row] ?? new Float64Array(0);
      if (row < col) {
        corr.push({ row, col, pearson: pearson(xs, ys), spearman: spearman(xs, ys) });
      } else if (row > col) {
        const n = Math.min(xs.length, ys.length);
        const step = Math.max(1, Math.ceil(n / cap));
        const cx: number[] = [];
        const cy: number[] = [];
        const chain: number[] = [];
        for (let i = 0; i < n; i += step) {
          cx.push(xs[i] ?? 0);
          cy.push(ys[i] ?? 0);
          chain.push(Math.floor(i / samples.nDraws));
        }
        cells.push({ row, col, x: cx, y: cy, chain });
      }
    }
  }

  return { kind: "splom", vars: used, nChains: samples.nChains, diagonals, corr, cells };
}

/** Per-variable min/max over pooled draws; degenerate spans widen so axes stay drawable. */
function parallelCoordsBound(variable: string, pooled: Float64Array): ParallelCoordsBound {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const v of pooled) {
    if (!Number.isFinite(v)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { variable, min: 0, max: 1 };
  if (max - min < 1e-9) return { variable, min, max: min + 1 };
  return { variable, min, max };
}

/**
 * Parallel-coordinates data over `vars` (default: all variables). `bounds` are per-variable
 * min/max over pooled draws; `lines` are per-chain sampled draws, each carrying that draw's
 * value of every variable, with the total line count capped by `opts.maxSamples`.
 */
export function parallelCoordsData(
  samples: Samples,
  vars?: string[],
  opts: { maxSamples?: number } = {},
): ParallelCoordsData {
  const maxSamples = Math.max(1, opts.maxSamples ?? 500);
  const used = vars ?? [...samples.variables];
  const { nChains, nDraws } = samples;

  const pooledOf = used.map((v) => samples.draws.get(v) ?? chainView(samples, v, 0));
  const bounds: ParallelCoordsBound[] = used.map((v, i) =>
    parallelCoordsBound(v, pooledOf[i] ?? new Float64Array(0)),
  );

  const perChain = Math.max(1, Math.floor(maxSamples / Math.max(1, nChains)));
  const step = Math.max(1, Math.ceil(nDraws / perChain));
  const lines: ParallelCoordsLine[] = [];
  const views = used.map((v) =>
    Array.from({ length: nChains }, (_, c) => chainView(samples, v, c)),
  );
  for (let c = 0; c < nChains; c++) {
    for (let d = 0; d < nDraws; d += step) {
      const values = used.map((_, vi) => views[vi]?.[c]?.[d] ?? Number.NaN);
      lines.push({ chain: c, values });
    }
  }

  return { kind: "parallel-coords", vars: used, nChains, bounds, lines };
}
