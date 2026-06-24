/**
 * Renderer-agnostic plot data: each `*Data` function turns a `Samples` set into
 * one of these plain, serializable objects, and each renderer (terminal, SVG,
 * ...) turns one of these into an artifact. The data layer holds all the
 * numerics; renderers hold no statistics.
 */

/** The diagnostic plots this package can produce. */
export type PlotKind = "trace" | "forest";

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

/** Color hook injected by a caller (e.g. the CLI) so the dependency-free
 *  renderer can colorize per-chain output without owning a color library. */
export type ColorFn = (text: string, chain: number) => string;

/** Options shared by the terminal renderers. */
export interface TerminalOptions {
  /** Plot width in character cells (default 72). */
  width?: number;
  /** Plot height in character cells (default 12). */
  height?: number;
  /** Glyph set: braille/block Unicode, or plain ASCII for limited terminals. */
  charset?: "unicode" | "ascii";
  /** Per-chain colorizer; identity when omitted. */
  color?: ColorFn;
  /** Colorizer for out-of-threshold values (e.g. a non-converged R-hat); identity when omitted. */
  warn?: (text: string) => string;
}
