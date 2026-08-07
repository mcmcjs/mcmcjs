import { readFileSync, writeFileSync } from "node:fs";
import { chainView, dropWarmup, loadDataFile, parseSamples } from "@mcmcjs/core";
import { computeLooPit } from "@mcmcjs/diagnostics";
import {
  type AutocorrData,
  autocorrData,
  buildHtmlDocument,
  type ChainIntervalsAllData,
  type ChainIntervalsData,
  type CornerData,
  type CornerTruth,
  type CumulativeMeanData,
  chainIntervalsAllData,
  chainIntervalsData,
  cornerData,
  cumulativeMeanData,
  type DensityData,
  type DiagnosticsHeatmapData,
  densityData,
  diagnosticsHeatmapData,
  type EcdfData,
  type EnergyData,
  ecdfData,
  energyData,
  type ForestData,
  forestData,
  type HistogramData,
  histogramData,
  type LooPitData,
  looPitData,
  type PairData,
  type ParallelCoordsData,
  type PlotData,
  type PpcDensityData,
  type PpcStat,
  type PpcStatData,
  pairData,
  parallelCoordsData,
  ppcDensityData,
  ppcStatData,
  type RankData,
  type RunningRhatData,
  rankData,
  renderAutocorrSVG,
  renderAutocorrTerminal,
  renderChainIntervalsAllSVG,
  renderChainIntervalsAllTerminal,
  renderChainIntervalsSVG,
  renderChainIntervalsTerminal,
  renderCornerSVG,
  renderCornerTerminal,
  renderCumulativeMeanSVG,
  renderCumulativeMeanTerminal,
  renderDensitySVG,
  renderDensityTerminal,
  renderDiagnosticsHeatmapSVG,
  renderDiagnosticsHeatmapTerminal,
  renderEcdfSVG,
  renderEcdfTerminal,
  renderEnergySVG,
  renderEnergyTerminal,
  renderForestSVG,
  renderForestTerminal,
  renderHistogramSVG,
  renderHistogramTerminal,
  renderLooPitSVG,
  renderLooPitTerminal,
  renderPairSVG,
  renderPairTerminal,
  renderParallelCoordsSVG,
  renderParallelCoordsTerminal,
  renderPpcDensitySVG,
  renderPpcDensityTerminal,
  renderPpcStatSVG,
  renderPpcStatTerminal,
  renderRankSVG,
  renderRankTerminal,
  renderRunningRhatSVG,
  renderRunningRhatTerminal,
  renderSplomSVG,
  renderSplomTerminal,
  renderSummaryTableSVG,
  renderSummaryTableTerminal,
  renderTraceSVG,
  renderTraceTerminal,
  renderViolinSVG,
  renderViolinTerminal,
  runningRhatData,
  type SplomData,
  type SummaryTableData,
  splomData,
  stackSvg,
  summaryTableData,
  type TerminalOptions,
  type TraceData,
  traceData,
  type ViolinData,
  violinData,
} from "@mcmcjs/plots";
import type { Command } from "commander";
import pc from "picocolors";
import { resolveSamplesText } from "./diagnose";
import { parseFloatOption, parseIntOption } from "./options";

function baseOf(name: string): string {
  const bracket = name.indexOf("[");
  return bracket === -1 ? name : name.slice(0, bracket);
}

function parseTruth(spec?: string): CornerTruth | undefined {
  if (!spec) return undefined;
  const values: Record<string, number> = {};
  for (const part of spec.split(",")) {
    const [name, raw] = part.split("=");
    const value = Number(raw);
    if (!name?.trim() || !Number.isFinite(value)) {
      throw new Error(`--truth expects name=value pairs, got "${part}"`);
    }
    values[name.trim()] = value;
  }
  return { values };
}

const KINDS = [
  "trace",
  "density",
  "histogram",
  "rank",
  "autocorr",
  "pair",
  "scatter",
  "energy",
  "forest",
  "ecdf",
  "cumulative-mean",
  "running-rhat",
  "violin",
  "chain-intervals",
  "chain-intervals-all",
  "summary-table",
  "diagnostics-heatmap",
  "splom",
  "parallel-coords",
  "corner",
  "ppc-density",
  "ppc-stat",
  "loo-pit",
] as const;
type PlotKind = (typeof KINDS)[number];
const FORMATS = ["terminal", "svg", "html"] as const;
type Format = (typeof FORMATS)[number];

interface PlotCliOptions {
  kind: string;
  format: string;
  var?: string[];
  store?: string;
  stdin?: boolean;
  warmup?: number;
  width?: number;
  height?: number;
  ascii?: boolean;
  hdiProb: number;
  bins?: number;
  maxLag?: number;
  colorBy?: string;
  truth?: string;
  observed?: string;
  stat?: string;
  loglik?: string;
  out?: string;
  json?: boolean;
}

// picocolors auto-disables on a non-TTY / NO_COLOR, so these are safe to always apply.
const PALETTE = [pc.cyan, pc.green, pc.yellow, pc.magenta, pc.blue, pc.red] as const;

function renderTerminal(kind: PlotKind, data: unknown, term: TerminalOptions): string {
  switch (kind) {
    case "forest":
      return renderForestTerminal(data as ForestData, term);
    case "density":
      return renderDensityTerminal(data as DensityData, term);
    case "histogram":
      return renderHistogramTerminal(data as HistogramData, term);
    case "rank":
      return renderRankTerminal(data as RankData, term);
    case "autocorr":
      return renderAutocorrTerminal(data as AutocorrData, term);
    case "pair":
    case "scatter":
      return renderPairTerminal(data as PairData, term);
    case "energy":
      return renderEnergyTerminal(data as EnergyData, term);
    case "ecdf":
      return renderEcdfTerminal(data as EcdfData, term);
    case "cumulative-mean":
      return renderCumulativeMeanTerminal(data as CumulativeMeanData, term);
    case "running-rhat":
      return renderRunningRhatTerminal(data as RunningRhatData, term);
    case "violin":
      return renderViolinTerminal(data as ViolinData, term);
    case "chain-intervals":
      return renderChainIntervalsTerminal(data as ChainIntervalsData, term);
    case "chain-intervals-all":
      return renderChainIntervalsAllTerminal(data as ChainIntervalsAllData, term);
    case "summary-table":
      return renderSummaryTableTerminal(data as SummaryTableData, term);
    case "diagnostics-heatmap":
      return renderDiagnosticsHeatmapTerminal(data as DiagnosticsHeatmapData, term);
    case "splom":
      return renderSplomTerminal(data as SplomData, term);
    case "corner":
      return renderCornerTerminal(data as CornerData, term);
    case "parallel-coords":
      return renderParallelCoordsTerminal(data as ParallelCoordsData, term);
    case "ppc-density":
      return renderPpcDensityTerminal(data as PpcDensityData, term);
    case "loo-pit":
      return renderLooPitTerminal(data as LooPitData, term);
    case "ppc-stat":
      return renderPpcStatTerminal(data as PpcStatData, term);
    default:
      return renderTraceTerminal(data as TraceData, term);
  }
}

function renderSvg(kind: PlotKind, data: unknown): string {
  switch (kind) {
    case "forest":
      return renderForestSVG(data as ForestData);
    case "density":
      return renderDensitySVG(data as DensityData);
    case "histogram":
      return renderHistogramSVG(data as HistogramData);
    case "autocorr":
      return renderAutocorrSVG(data as AutocorrData);
    case "rank":
      return renderRankSVG(data as RankData);
    case "pair":
    case "scatter":
      return renderPairSVG(data as PairData);
    case "energy":
      return renderEnergySVG(data as EnergyData);
    case "ecdf":
      return renderEcdfSVG(data as EcdfData);
    case "cumulative-mean":
      return renderCumulativeMeanSVG(data as CumulativeMeanData);
    case "running-rhat":
      return renderRunningRhatSVG(data as RunningRhatData);
    case "violin":
      return renderViolinSVG(data as ViolinData);
    case "chain-intervals":
      return renderChainIntervalsSVG(data as ChainIntervalsData);
    case "chain-intervals-all":
      return renderChainIntervalsAllSVG(data as ChainIntervalsAllData);
    case "summary-table":
      return renderSummaryTableSVG(data as SummaryTableData);
    case "diagnostics-heatmap":
      return renderDiagnosticsHeatmapSVG(data as DiagnosticsHeatmapData);
    case "splom":
      return renderSplomSVG(data as SplomData);
    case "corner":
      return renderCornerSVG(data as CornerData);
    case "parallel-coords":
      return renderParallelCoordsSVG(data as ParallelCoordsData);
    case "ppc-density":
      return renderPpcDensitySVG(data as PpcDensityData);
    case "loo-pit":
      return renderLooPitSVG(data as LooPitData);
    case "ppc-stat":
      return renderPpcStatSVG(data as PpcStatData);
    default:
      return renderTraceSVG(data as TraceData);
  }
}

export function registerPlot(program: Command): void {
  program
    .command("plot")
    .summary("diagnostic plots for a samples file")
    .helpGroup("Inspect runs:")
    .argument(
      "[target]",
      "samples file (MCMCChains JSON or ArviZ InferenceData JSON), or a run ref (latest, @N, id prefix); default: the latest store run",
    )
    .description(
      "Render MCMC diagnostic plots (trace, density, histogram, rank, autocorr, pair, scatter, energy, forest, ecdf, cumulative-mean, running-rhat, violin, chain-intervals, chain-intervals-all, summary-table, diagnostics-heatmap, splom, parallel-coords, corner, ppc-density, ppc-stat)",
    )
    .option("--kind <kind>", `plot type: ${KINDS.join(" | ")}`, "forest")
    .option("--format <fmt>", `output format: ${FORMATS.join(" | ")}`, "terminal")
    .option("--var <name...>", "restrict to these variables (default: all)")
    .option("--store <dir>", "run store directory (default: nearest .mcmc above cwd)")
    .option("--stdin", "read the samples from stdin instead of a file/run ref")
    .option(
      "--warmup <n>",
      "discard the first n draws of each chain before computing",
      parseIntOption,
    )
    .option("--width <n>", "plot width (characters for terminal, pixels for svg)", parseIntOption)
    .option("--height <n>", "plot height (characters for terminal, pixels for svg)", parseIntOption)
    .option("--ascii", "use ASCII glyphs instead of Unicode braille/blocks (terminal)")
    .option("--hdi-prob <value>", "HDI credible mass (forest)", parseFloatOption, 0.94)
    .option("--bins <n>", "histogram/rank bins (default: Freedman-Diaconis / 20)", parseIntOption)
    .option("--max-lag <n>", "autocorrelation max lag (default 40)", parseIntOption)
    .option("--color-by <var>", "color scatter points by a third variable via viridis (svg/html)")
    .option("--truth <pairs>", 'reference values on a corner plot, e.g. "mu=1.08,tau=4"')
    .option(
      "--observed <file>",
      "observed data file (.json object or .csv columns) for a predictive check (ppc-*)",
    )
    .option("--stat <name>", "test statistic for --kind ppc-stat: mean | sd | min | max", "mean")
    .option(
      "--loglik <file>",
      "pointwise log-likelihood file for --kind loo-pit (mcmc export loglik)",
    )
    .option("-o, --out <file>", "write the rendered plot to a file instead of stdout")
    .option("--json", "print the underlying plot data as JSON instead of rendering")
    .action((target: string | undefined, opts: PlotCliOptions) => {
      const kind = opts.kind as PlotKind;
      if (!KINDS.includes(kind)) {
        throw new Error(`unknown --kind "${opts.kind}"; expected one of: ${KINDS.join(", ")}`);
      }
      const format = opts.format as Format;
      if (!FORMATS.includes(format)) {
        throw new Error(
          `unknown --format "${opts.format}"; expected one of: ${FORMATS.join(", ")}`,
        );
      }
      if (opts.warmup !== undefined && opts.warmup < 0) {
        throw new Error("--warmup must be a non-negative integer");
      }
      let samples = parseSamples(resolveSamplesText(target, opts));
      if (opts.warmup !== undefined) samples = dropWarmup(samples, opts.warmup);
      const variables = opts.var ?? samples.variables;

      // forest/splom/parallel-coords take all variables in one plot; pair takes exactly two; the rest are per-variable.
      let items: unknown[];
      if (kind === "forest") {
        items = [forestData(samples, { variables, hdiProb: opts.hdiProb })];
      } else if (kind === "energy") {
        items = [energyData(samples, { bins: opts.bins })];
      } else if (kind === "chain-intervals-all") {
        items = [chainIntervalsAllData(samples, { variables })];
      } else if (kind === "summary-table") {
        items = [summaryTableData(samples, { variables })];
      } else if (kind === "diagnostics-heatmap") {
        items = [diagnosticsHeatmapData(samples, { variables })];
      } else if (kind === "splom") {
        items = [splomData(samples, [...variables])];
      } else if (kind === "corner") {
        const truth = parseTruth(opts.truth);
        items = [
          cornerData([{ samples }], {
            vars: [...variables],
            ...(truth ? { truth: [truth] } : {}),
          }),
        ];
      } else if (kind === "parallel-coords") {
        items = [parallelCoordsData(samples, [...variables])];
      } else if (kind === "loo-pit") {
        if (!opts.observed || !opts.loglik) {
          throw new Error(
            "--kind loo-pit needs the observed data and the pointwise log-likelihood; pass --observed <file> and --loglik <file> (mcmc export loglik)",
          );
        }
        const data = loadDataFile(opts.observed);
        const variable =
          opts.var?.[0] ?? [...new Set(samples.variables.map(baseOf))].find(() => true);
        const values = variable !== undefined ? data[variable] : undefined;
        if (variable === undefined || !Array.isArray(values)) {
          throw new Error(
            `--observed ${opts.observed} has no numeric column "${variable ?? "?"}"; pass --var to name the outcome`,
          );
        }
        const observed = (values as unknown[]).map(Number);
        const ll = parseSamples(readFileSync(opts.loglik, "utf8"));
        const perObs = (source: typeof samples, names: string[]) =>
          names.map((v) =>
            Array.from({ length: source.nChains }, (_, c) => chainView(source, v, c)),
          );
        const yrepNames = samples.variables.filter(
          (v) => v === variable || v.startsWith(`${variable}[`),
        );
        const pit = computeLooPit(
          perObs(ll, [...ll.variables]),
          perObs(samples, yrepNames),
          observed,
        );
        items = [looPitData(pit, { variable })];
      } else if (kind === "ppc-density" || kind === "ppc-stat") {
        if (!opts.observed) {
          throw new Error(
            `--kind ${kind} compares predictive draws to data; pass --observed <file>`,
          );
        }
        const data = loadDataFile(opts.observed);
        const variable =
          opts.var?.[0] ?? [...new Set(samples.variables.map(baseOf))].find(() => true);
        const values = variable !== undefined ? data[variable] : undefined;
        if (variable === undefined || !Array.isArray(values)) {
          throw new Error(
            `--observed ${opts.observed} has no numeric column "${variable ?? "?"}"; pass --var to name the outcome`,
          );
        }
        const observed = (values as unknown[]).map(Number);
        items =
          kind === "ppc-density"
            ? [ppcDensityData(samples, observed, { variable })]
            : [
                ppcStatData(samples, observed, {
                  variable,
                  stat: opts.stat as PpcStat,
                  bins: opts.bins,
                }),
              ];
      } else if (kind === "pair" || kind === "scatter") {
        if (variables.length !== 2) {
          throw new Error(`--kind ${kind} needs exactly two variables, e.g. --var alpha beta`);
        }
        items = [
          pairData(samples, variables[0] as string, variables[1] as string, {
            colorVar: opts.colorBy,
          }),
        ];
      } else {
        items = variables.map((v) => {
          switch (kind) {
            case "density":
              return densityData(samples, v);
            case "histogram":
              return histogramData(samples, v, { bins: opts.bins });
            case "rank":
              return rankData(samples, v, { bins: opts.bins });
            case "autocorr":
              return autocorrData(samples, v, { maxLag: opts.maxLag });
            case "ecdf":
              return ecdfData(samples, v);
            case "cumulative-mean":
              return cumulativeMeanData(samples, v);
            case "running-rhat":
              return runningRhatData(samples, v);
            case "violin":
              return violinData(samples, v);
            case "chain-intervals":
              return chainIntervalsData(samples, v);
            default:
              return traceData(samples, v);
          }
        });
      }

      const emit = (content: string, label: string): void => {
        if (opts.out) {
          writeFileSync(opts.out, content);
          process.stdout.write(`wrote ${label} to ${opts.out}\n`);
        } else {
          process.stdout.write(content.endsWith("\n") ? content : `${content}\n`);
        }
      };

      if (opts.json) {
        emit(`${JSON.stringify(items.length === 1 ? items[0] : items, null, 2)}\n`, `${kind} data`);
        return;
      }

      if (format === "svg") {
        emit(stackSvg(items.map((d) => renderSvg(kind, d))), `${kind} SVG`);
        return;
      }

      if (format === "html") {
        const html = buildHtmlDocument(items as PlotData[], { title: `mcmc ${kind}` });
        emit(html, `${kind} HTML`);
        return;
      }

      const term: TerminalOptions = {
        width: opts.width,
        height: opts.height,
        charset: opts.ascii ? "ascii" : "unicode",
        color: (text, chain) => (PALETTE[chain % PALETTE.length] ?? pc.white)(text),
        warn: (text) => pc.yellow(text),
      };
      emit(items.map((d) => renderTerminal(kind, d, term)).join("\n"), `${kind} plot`);
    });
}
