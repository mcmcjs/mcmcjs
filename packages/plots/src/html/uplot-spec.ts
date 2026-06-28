/**
 * Pure, JSON-serializable uPlot specs. Each builder turns one `*Data` object into
 * a `{ data, series }` description with no functions in it: path styles (bars,
 * stepped) are carried as string flags and the in-browser bootstrap rehydrates the
 * matching `uPlot.paths.*` builder. Plot kinds that uPlot cannot draw well (forest,
 * pair) are emitted as embedded SVG instead.
 */
import { seriesColor } from "@mcmcjs/charts";
import {
  renderChainIntervalsAllSVG,
  renderChainIntervalsSVG,
  renderDiagnosticsHeatmapSVG,
  renderForestSVG,
  renderPairSVG,
  renderParallelCoordsSVG,
  renderSplomSVG,
  renderSummaryTableSVG,
  renderViolinSVG,
} from "../svg";
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
  PairData,
  ParallelCoordsData,
  PlotKind,
  RankData,
  RunningRhatData,
  SplomData,
  SummaryTableData,
  TraceData,
  ViolinData,
} from "../types";

/** Any of the renderer-agnostic plot data objects. */
export type PlotData =
  | TraceData
  | DensityData
  | HistogramData
  | RankData
  | AutocorrData
  | EnergyData
  | PairData
  | ForestData
  | EcdfData
  | CumulativeMeanData
  | RunningRhatData
  | ViolinData
  | ChainIntervalsData
  | ChainIntervalsAllData
  | SummaryTableData
  | DiagnosticsHeatmapData
  | SplomData
  | ParallelCoordsData;

/** One uPlot series, described declaratively (no functions). */
export interface UplotSeriesSpec {
  label: string;
  stroke: string;
  fill?: string;
  /** Path style flag; the bootstrap maps it to a `uPlot.paths.*` builder. */
  paths?: "bars" | "stepped";
  /** Dash pattern in px (e.g. reference lines). */
  dash?: number[];
  width?: number;
  /** Tags a real chain so a consumer can subset chains without per-kind special-casing. */
  role?: "chain";
}

/** A horizontal guide line drawn over the plot rather than carried as a data series. */
export interface UplotRefLine {
  value: number;
  label?: string;
  stroke?: string;
  dash?: number[];
}

/** A function-free uPlot chart description: aligned data plus series styling. */
export interface UplotSpec {
  title: string;
  xLabel?: string;
  yLabel?: string;
  /** `data[0]` is the shared x; `data[1..]` align to `series` (null = gap). */
  data: (number | null)[][];
  series: UplotSeriesSpec[];
  /** Reference guide lines (e.g. an R-hat threshold), kept out of `data`/`series`. */
  refLines?: UplotRefLine[];
}

/** A single renderable unit of an HTML document: an interactive chart or static SVG. */
export type HtmlItem =
  | { mode: "uplot"; kind: PlotKind; title: string; spec: UplotSpec }
  | { mode: "svg"; kind: PlotKind; title: string; svg: string };

function fade(hex: string): string {
  return `${hex}55`;
}

/** Identity of chain at array position `c`: the caller-supplied id, else its position. */
function chainIdAt(chainIds: number[] | undefined, c: number): number {
  return chainIds?.[c] ?? c;
}

/** A chain series colored and labeled by chain identity (stable across chain subsets). */
function chainSeries(
  chainIds: number[] | undefined,
  c: number,
  extra: Partial<UplotSeriesSpec> = {},
): UplotSeriesSpec {
  const id = chainIdAt(chainIds, c);
  return { label: `chain ${id + 1}`, stroke: seriesColor(id), role: "chain", ...extra };
}

function traceSpec(d: TraceData): UplotSpec {
  const x = Array.from({ length: d.nDraws }, (_, i) => i);
  const rhat = Number.isFinite(d.rhat) ? d.rhat.toFixed(3) : "n/a";
  const ess = Number.isFinite(d.essBulk) ? String(Math.round(d.essBulk)) : "n/a";
  return {
    title: `${d.variable}  (R-hat ${rhat}, ESS ${ess})`,
    xLabel: "iteration",
    yLabel: d.variable,
    data: [x, ...d.chains],
    series: d.chains.map((_, c) => chainSeries(d.chainIds, c)),
  };
}

function densitySpec(d: DensityData): UplotSpec {
  return {
    title: `${d.variable}  density`,
    xLabel: d.variable,
    yLabel: "density",
    data: [d.x, ...d.chains],
    series: d.chains.map((_, c) => chainSeries(d.chainIds, c)),
  };
}

function histogramSpec(d: HistogramData): UplotSpec {
  const centers = d.counts.map((_, b) => ((d.binEdges[b] ?? 0) + (d.binEdges[b + 1] ?? 0)) / 2);
  const stroke = seriesColor(0);
  return {
    title: `${d.variable}  histogram (${d.counts.length} bins)`,
    xLabel: d.variable,
    yLabel: "count",
    data: [centers, d.counts],
    series: [{ label: "count", stroke, fill: fade(stroke), paths: "bars" }],
  };
}

function rankSpec(d: RankData): UplotSpec {
  const x = Array.from({ length: d.bins }, (_, b) => b);
  return {
    title: `${d.variable}  rank (${d.bins} bins, ${d.nChains} chains)`,
    xLabel: "rank bin",
    yLabel: "count",
    data: [x, ...d.counts],
    series: d.counts.map((_, c) => chainSeries(d.chainIds, c, { paths: "stepped" })),
    refLines: [{ value: d.expected, label: "uniform" }],
  };
}

function autocorrSpec(d: AutocorrData): UplotSpec {
  return {
    title: `${d.variable}  autocorrelation`,
    xLabel: "lag",
    yLabel: "acf",
    data: [d.lags, ...d.chains],
    series: d.chains.map((_, c) => chainSeries(d.chainIds, c)),
    refLines: [{ value: 0, label: "zero" }],
  };
}

function energySpec(d: EnergyData): UplotSpec {
  const centers = d.marginal.map((_, b) => ((d.edges[b] ?? 0) + (d.edges[b + 1] ?? 0)) / 2);
  const finite = d.bfmi.filter(Number.isFinite);
  const bfmi = finite.length ? finite.reduce((a, b) => a + b, 0) / finite.length : Number.NaN;
  return {
    title: `energy  (E-BFMI ${Number.isFinite(bfmi) ? bfmi.toFixed(2) : "n/a"})`,
    xLabel: "energy (centered)",
    yLabel: "count",
    data: [centers, d.marginal, d.transition],
    series: [
      { label: "marginal", stroke: seriesColor(0) },
      { label: "transition", stroke: seriesColor(1) },
    ],
  };
}

function ecdfSpec(d: EcdfData): UplotSpec {
  // uPlot needs a shared x, so resample each chain onto the sorted union of all draws
  // with a left-continuous step (probability before the first draw is 0).
  const commonX = [...new Set(d.series.flatMap((s) => s.x))].sort((a, b) => a - b);
  const rows = d.series.map((s) => {
    const out: number[] = [];
    let idx = 0;
    for (const cx of commonX) {
      while (idx < s.x.length && (s.x[idx] as number) <= cx) idx++;
      out.push(idx === 0 ? 0 : (s.y[idx - 1] as number));
    }
    return out;
  });
  return {
    title: `${d.variable}  ECDF`,
    xLabel: d.variable,
    yLabel: "P",
    data: [commonX, ...rows],
    series: d.series.map((s) => ({
      label: `chain ${s.chain + 1}`,
      stroke: seriesColor(s.chain),
      paths: "stepped" as const,
      role: "chain" as const,
    })),
  };
}

function cumulativeMeanSpec(d: CumulativeMeanData): UplotSpec {
  const maxLen = d.iterations.length;
  const rows = d.chains.map((vals) =>
    Array.from({ length: maxLen }, (_, i) => (i < vals.length ? (vals[i] as number) : null)),
  );
  return {
    title: `${d.variable}  cumulative mean`,
    xLabel: "iteration",
    yLabel: `mean (${d.variable})`,
    data: [d.iterations, ...rows],
    series: d.chains.map((_, c) => chainSeries(d.chainIds, c)),
  };
}

function runningRhatSpec(d: RunningRhatData): UplotSpec {
  return {
    title: `${d.variable}  running basic R-hat`,
    xLabel: "iteration",
    yLabel: "R-hat",
    data: [d.iterations, d.rhat],
    series: [{ label: "R-hat", stroke: seriesColor(0) }],
    refLines: [
      { value: 1, label: "1.00", stroke: "#22c55e" },
      { value: 1.05, label: "1.05", stroke: "#ef4444" },
    ],
  };
}

/** Turn any plot data object into a renderable HTML item (interactive uPlot or SVG). */
export function htmlItemFor(d: PlotData): HtmlItem {
  switch (d.kind) {
    case "trace":
      return { mode: "uplot", kind: d.kind, title: d.variable, spec: traceSpec(d) };
    case "density":
      return { mode: "uplot", kind: d.kind, title: d.variable, spec: densitySpec(d) };
    case "histogram":
      return { mode: "uplot", kind: d.kind, title: d.variable, spec: histogramSpec(d) };
    case "rank":
      return { mode: "uplot", kind: d.kind, title: d.variable, spec: rankSpec(d) };
    case "autocorr":
      return { mode: "uplot", kind: d.kind, title: d.variable, spec: autocorrSpec(d) };
    case "energy":
      return { mode: "uplot", kind: d.kind, title: "energy", spec: energySpec(d) };
    case "ecdf":
      return { mode: "uplot", kind: d.kind, title: d.variable, spec: ecdfSpec(d) };
    case "cumulative-mean":
      return { mode: "uplot", kind: d.kind, title: d.variable, spec: cumulativeMeanSpec(d) };
    case "running-rhat":
      return { mode: "uplot", kind: d.kind, title: d.variable, spec: runningRhatSpec(d) };
    case "pair":
      return {
        mode: "svg",
        kind: d.kind,
        title: `${d.xVar} vs ${d.yVar}`,
        svg: renderPairSVG(d),
      };
    case "forest":
      return { mode: "svg", kind: d.kind, title: "forest", svg: renderForestSVG(d) };
    case "violin":
      return { mode: "svg", kind: d.kind, title: d.variable, svg: renderViolinSVG(d) };
    case "chain-intervals":
      return { mode: "svg", kind: d.kind, title: d.variable, svg: renderChainIntervalsSVG(d) };
    case "chain-intervals-all":
      return {
        mode: "svg",
        kind: d.kind,
        title: "chain intervals",
        svg: renderChainIntervalsAllSVG(d),
      };
    case "summary-table":
      return { mode: "svg", kind: d.kind, title: "summary", svg: renderSummaryTableSVG(d) };
    case "diagnostics-heatmap":
      return {
        mode: "svg",
        kind: d.kind,
        title: "diagnostics",
        svg: renderDiagnosticsHeatmapSVG(d),
      };
    case "splom":
      return { mode: "svg", kind: d.kind, title: "pairs", svg: renderSplomSVG(d) };
    case "parallel-coords":
      return {
        mode: "svg",
        kind: d.kind,
        title: "parallel coordinates",
        svg: renderParallelCoordsSVG(d),
      };
  }
}
