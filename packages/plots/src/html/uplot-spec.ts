/**
 * Pure, JSON-serializable uPlot specs. Each builder turns one `*Data` object into
 * a `{ data, series }` description with no functions in it: path styles (bars,
 * stepped) are carried as string flags and the in-browser bootstrap rehydrates the
 * matching `uPlot.paths.*` builder. Plot kinds that uPlot cannot draw well (forest,
 * pair) are emitted as embedded SVG instead.
 */
import { seriesColor } from "@mcmcjs/charts";
import { renderForestSVG, renderPairSVG } from "../svg";
import type {
  AutocorrData,
  DensityData,
  EnergyData,
  ForestData,
  HistogramData,
  PairData,
  PlotKind,
  RankData,
  TraceData,
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
  | ForestData;

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
}

/** A function-free uPlot chart description: aligned data plus series styling. */
export interface UplotSpec {
  title: string;
  xLabel?: string;
  yLabel?: string;
  /** `data[0]` is the shared x; `data[1..]` align to `series`. */
  data: number[][];
  series: UplotSeriesSpec[];
}

/** A single renderable unit of an HTML document: an interactive chart or static SVG. */
export type HtmlItem =
  | { mode: "uplot"; kind: PlotKind; title: string; spec: UplotSpec }
  | { mode: "svg"; kind: PlotKind; title: string; svg: string };

function fade(hex: string): string {
  return `${hex}55`;
}

/** A constant horizontal series used as a dashed reference line. */
function refLine(value: number, length: number, label: string): [number[], UplotSeriesSpec] {
  return [
    new Array<number>(length).fill(value),
    { label, stroke: "#9ca3af", dash: [4, 4], width: 1 },
  ];
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
    series: d.chains.map((_, c) => ({ label: `chain ${c + 1}`, stroke: seriesColor(c) })),
  };
}

function densitySpec(d: DensityData): UplotSpec {
  return {
    title: `${d.variable}  density`,
    xLabel: d.variable,
    yLabel: "density",
    data: [d.x, ...d.chains],
    series: d.chains.map((_, c) => ({ label: `chain ${c + 1}`, stroke: seriesColor(c) })),
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
  const [refData, refSeries] = refLine(d.expected, d.bins, "uniform");
  return {
    title: `${d.variable}  rank (${d.bins} bins, ${d.nChains} chains)`,
    xLabel: "rank bin",
    yLabel: "count",
    data: [x, ...d.counts, refData],
    series: [
      ...d.counts.map((_, c) => ({
        label: `chain ${c + 1}`,
        stroke: seriesColor(c),
        paths: "stepped" as const,
      })),
      refSeries,
    ],
  };
}

function autocorrSpec(d: AutocorrData): UplotSpec {
  const [refData, refSeries] = refLine(0, d.lags.length, "zero");
  return {
    title: `${d.variable}  autocorrelation`,
    xLabel: "lag",
    yLabel: "acf",
    data: [d.lags, ...d.chains, refData],
    series: [
      ...d.chains.map((_, c) => ({ label: `chain ${c + 1}`, stroke: seriesColor(c) })),
      refSeries,
    ],
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
    case "pair":
      return {
        mode: "svg",
        kind: d.kind,
        title: `${d.xVar} vs ${d.yVar}`,
        svg: renderPairSVG(d),
      };
    case "forest":
      return { mode: "svg", kind: d.kind, title: "forest", svg: renderForestSVG(d) };
  }
}
