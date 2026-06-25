/**
 * Renderer-agnostic plot data: each `*Data` function turns a `Samples` set into
 * one of these plain, serializable objects, and each renderer (terminal, SVG,
 * ...) turns one of these into an artifact. The data layer holds all the
 * numerics; renderers hold no statistics.
 */

import type { Charset, ColorFn } from "@mcmcjs/charts";

export type { Charset, ColorFn } from "@mcmcjs/charts";

/** The diagnostic plots this package can produce. */
export type PlotKind =
  | "trace"
  | "density"
  | "histogram"
  | "rank"
  | "autocorr"
  | "pair"
  | "energy"
  | "forest"
  | "ecdf"
  | "cumulative-mean"
  | "running-rhat"
  | "violin"
  | "chain-intervals"
  | "chain-intervals-all";

/** Per-variable trace: the raw draw sequence of each chain, plus its key diagnostics. */
export interface TraceData {
  kind: "trace";
  variable: string;
  nChains: number;
  nDraws: number;
  /** One array of length nDraws per chain, in iteration order. */
  chains: number[][];
  /** Rank-normalized R-hat across chains (NaN when undefined). */
  rhat: number;
  /** Bulk effective sample size (NaN when undefined). */
  essBulk: number;
}

/** Per-variable kernel-density estimate: one curve per chain over a shared x-grid. */
export interface DensityData {
  kind: "density";
  variable: string;
  nChains: number;
  /** Shared evaluation grid (length gridSize), ascending. */
  x: number[];
  /** One density curve per chain, each aligned to `x`. */
  chains: number[][];
}

/** Per-variable pooled histogram: bin edges (length bins+1) and counts (length bins). */
export interface HistogramData {
  kind: "histogram";
  variable: string;
  binEdges: number[];
  counts: number[];
  /** Total number of draws pooled across chains. */
  total: number;
}

/** Rank plot: per-chain counts of rank-normalized draws across shared bins. */
export interface RankData {
  kind: "rank";
  variable: string;
  nChains: number;
  bins: number;
  /** One count array (length bins) per chain. */
  counts: number[][];
  /** Uniform-mixing expectation per bin per chain. */
  expected: number;
}

/** Autocorrelation plot: ACF vs lag, one series per chain. */
export interface AutocorrData {
  kind: "autocorr";
  variable: string;
  nChains: number;
  maxLag: number;
  /** Lag indices 0..maxLag. */
  lags: number[];
  /** One ACF array per chain, aligned to `lags`. */
  chains: number[][];
}

/** Energy plot (HMC/NUTS): overlaid marginal- and transition-energy histograms on shared bins. */
export interface EnergyData {
  kind: "energy";
  /** Shared bin edges (length bins + 1), over centered energy. */
  edges: number[];
  /** Counts of the centered marginal energy. */
  marginal: number[];
  /** Counts of the energy transitions (lag-1 differences). */
  transition: number[];
  /** Per-chain E-BFMI (low values, < 0.3, flag poor exploration). */
  bfmi: number[];
}

/** Pair (joint) plot: pooled draws of two variables, with chain and divergence labels. */
export interface PairData {
  kind: "pair";
  xVar: string;
  yVar: string;
  nChains: number;
  /** Parallel pooled (chain-major) arrays of equal length. */
  x: number[];
  y: number[];
  /** 0-based chain index per point. */
  chain: number[];
  /** Whether each draw was a divergent transition. */
  diverging: boolean[];
}

/** One row of a forest plot: a point estimate with a credible interval and IQR. */
export interface ForestRow {
  variable: string;
  mean: number;
  /** Highest-density interval at `hdiProb` mass. */
  hdi: [number, number];
  /** Inter-quartile range (25th, 75th percentiles). */
  iqr: [number, number];
  rhat: number;
  essBulk: number;
  /** Whether this variable meets the default convergence thresholds. */
  converged: boolean;
}

/** A forest plot: one interval row per variable, sharing an x-axis. */
export interface ForestData {
  kind: "forest";
  hdiProb: number;
  rows: ForestRow[];
}

/** Empirical CDF: per chain, the sorted draws and their cumulative probabilities. */
export interface EcdfData {
  kind: "ecdf";
  variable: string;
  nChains: number;
  /** One series per chain; `x` (sorted draws) and `y` (cumulative prob) are equal length. */
  series: { chain: number; x: number[]; y: number[] }[];
}

/** Cumulative (running) mean per chain over shared 1-based iterations. */
export interface CumulativeMeanData {
  kind: "cumulative-mean";
  variable: string;
  nChains: number;
  /** Shared iteration axis `1..maxLen`. */
  iterations: number[];
  /** One running-mean array per chain (may be shorter than `iterations`). */
  chains: number[][];
}

/** Running split-R-hat over an increasing prefix of draws (empty when undefined). */
export interface RunningRhatData {
  kind: "running-rhat";
  variable: string;
  nChains: number;
  /** Prefix lengths at which R-hat was evaluated. */
  iterations: number[];
  /** Basic split-R-hat aligned to `iterations`. */
  rhat: number[];
}

/** One interval row: a 90% (q5..q95) and 50% (q25..q75) band around the median q50. */
export interface IntervalRow {
  label: string;
  q5: number;
  q25: number;
  q50: number;
  q75: number;
  q95: number;
}

/** Per-chain credible intervals for one variable (one row per chain). */
export interface ChainIntervalsData {
  kind: "chain-intervals";
  variable: string;
  rows: IntervalRow[];
}

/** Pooled credible intervals across variables (one row per variable). */
export interface ChainIntervalsAllData {
  kind: "chain-intervals-all";
  rows: IntervalRow[];
}

/** One violin row: a peak-normalized KDE band plus summary stats. */
export interface ViolinRow {
  label: string;
  /** KDE grid (length gridSize), ascending. */
  x: number[];
  /** Peak-normalized density in [0,1], aligned to `x`. */
  density: number[];
  mean: number;
  stdev: number;
  q5: number;
  q50: number;
  q95: number;
}

/** Violin plot: one mirrored KDE band per chain for a variable. */
export interface ViolinData {
  kind: "violin";
  variable: string;
  gridSize: number;
  rows: ViolinRow[];
}

/** Options shared by the terminal renderers. */
export interface TerminalOptions {
  /** Plot width in character cells (default 72). */
  width?: number;
  /** Plot height in character cells (default 12). */
  height?: number;
  /** Glyph set: braille/block Unicode, or plain ASCII for limited terminals. */
  charset?: Charset;
  /** Per-chain (series) colorizer; identity when omitted. */
  color?: ColorFn;
  /** Colorizer for out-of-threshold values (e.g. a non-converged R-hat); identity when omitted. */
  warn?: (text: string) => string;
}

/** Options for the SVG renderers (pixel dimensions). */
export interface SvgOptions {
  /** Figure width in pixels (default 640). */
  width?: number;
  /** Figure height in pixels (default 220; forest scales with row count). */
  height?: number;
}
