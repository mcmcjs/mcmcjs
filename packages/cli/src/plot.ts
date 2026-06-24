import { readFileSync, writeFileSync } from "node:fs";
import { parseSamples } from "@mcmcjs/core";
import {
  autocorrData,
  densityData,
  forestData,
  histogramData,
  rankData,
  renderAutocorrTerminal,
  renderDensityTerminal,
  renderForestTerminal,
  renderHistogramTerminal,
  renderRankTerminal,
  renderTraceTerminal,
  type TerminalOptions,
  traceData,
} from "@mcmcjs/plots";
import type { Command } from "commander";
import pc from "picocolors";
import { resolveSamplesPath } from "./diagnose";
import { parseFloatOption, parseIntOption } from "./options";

const KINDS = ["trace", "density", "histogram", "rank", "autocorr", "forest"] as const;
type PlotKind = (typeof KINDS)[number];

interface PlotCliOptions {
  kind: string;
  var?: string[];
  store?: string;
  width?: number;
  height?: number;
  ascii?: boolean;
  hdiProb: number;
  bins?: number;
  maxLag?: number;
  out?: string;
  json?: boolean;
}

// picocolors auto-disables on a non-TTY / NO_COLOR, so these are safe to always apply.
const PALETTE = [pc.cyan, pc.green, pc.yellow, pc.magenta, pc.blue, pc.red] as const;

export function registerPlot(program: Command): void {
  program
    .command("plot")
    .summary("diagnostic plots for a samples file")
    .helpGroup("Inspect runs:")
    .argument(
      "[target]",
      "samples file (MCMCChains JSON or ArviZ InferenceData JSON), or a run ref (latest, @N, id prefix); default: the latest store run",
    )
    .description("Render MCMC diagnostic plots (trace, density, histogram, rank, autocorr, forest)")
    .option("--kind <kind>", `plot type: ${KINDS.join(" | ")}`, "forest")
    .option("--var <name...>", "restrict to these variables (default: all)")
    .option("--store <dir>", "run store directory (default: nearest .mcmc above cwd)")
    .option("--width <cells>", "plot width in characters", parseIntOption)
    .option(
      "--height <cells>",
      "plot height in characters (trace/density/histogram)",
      parseIntOption,
    )
    .option("--ascii", "use ASCII glyphs instead of Unicode braille/blocks")
    .option("--hdi-prob <value>", "HDI credible mass (forest)", parseFloatOption, 0.94)
    .option("--bins <n>", "histogram/rank bins (default: Freedman-Diaconis / 20)", parseIntOption)
    .option("--max-lag <n>", "autocorrelation max lag (default 40)", parseIntOption)
    .option("-o, --out <file>", "write the rendered plot to a file instead of stdout")
    .option("--json", "print the underlying plot data as JSON instead of rendering")
    .action((target: string | undefined, opts: PlotCliOptions) => {
      const kind = opts.kind as PlotKind;
      if (!KINDS.includes(kind)) {
        throw new Error(`unknown --kind "${opts.kind}"; expected one of: ${KINDS.join(", ")}`);
      }
      const samples = parseSamples(readFileSync(resolveSamplesPath(target, opts.store), "utf8"));
      const variables = opts.var ?? samples.variables;

      const term: TerminalOptions = {
        width: opts.width,
        height: opts.height,
        charset: opts.ascii ? "ascii" : "unicode",
        color: (text, chain) => (PALETTE[chain % PALETTE.length] ?? pc.white)(text),
        warn: (text) => pc.yellow(text),
      };

      let rendered: string;
      let data: unknown;
      if (kind === "forest") {
        const fd = forestData(samples, { variables, hdiProb: opts.hdiProb });
        data = fd;
        rendered = renderForestTerminal(fd, term);
      } else {
        // trace/density/histogram/rank/autocorr are per-variable; render one block each.
        const perVar = variables.map((v) => {
          if (kind === "density") {
            const d = densityData(samples, v);
            return { data: d, text: renderDensityTerminal(d, term) };
          }
          if (kind === "histogram") {
            const d = histogramData(samples, v, { bins: opts.bins });
            return { data: d, text: renderHistogramTerminal(d, term) };
          }
          if (kind === "rank") {
            const d = rankData(samples, v, { bins: opts.bins });
            return { data: d, text: renderRankTerminal(d, term) };
          }
          if (kind === "autocorr") {
            const d = autocorrData(samples, v, { maxLag: opts.maxLag });
            return { data: d, text: renderAutocorrTerminal(d, term) };
          }
          const d = traceData(samples, v);
          return { data: d, text: renderTraceTerminal(d, term) };
        });
        data = perVar.length === 1 ? perVar[0]?.data : perVar.map((p) => p.data);
        rendered = perVar.map((p) => p.text).join("\n");
      }

      if (opts.json) {
        const json = `${JSON.stringify(data, null, 2)}\n`;
        if (opts.out) writeFileSync(opts.out, json);
        else process.stdout.write(json);
        return;
      }

      if (opts.out) {
        writeFileSync(opts.out, rendered);
        process.stdout.write(`wrote ${kind} plot to ${opts.out}\n`);
      } else {
        process.stdout.write(rendered);
      }
    });
}
