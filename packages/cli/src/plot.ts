import { readFileSync, writeFileSync } from "node:fs";
import { parseSamples } from "@mcmcjs/core";
import {
  forestData,
  renderForestTerminal,
  renderTraceTerminal,
  type TerminalOptions,
  traceData,
} from "@mcmcjs/plots";
import type { Command } from "commander";
import pc from "picocolors";
import { resolveSamplesPath } from "./diagnose";
import { parseFloatOption, parseIntOption } from "./options";

const KINDS = ["trace", "forest"] as const;
type PlotKind = (typeof KINDS)[number];

interface PlotCliOptions {
  kind: string;
  var?: string[];
  store?: string;
  width?: number;
  height?: number;
  ascii?: boolean;
  hdiProb: number;
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
    .description("Render MCMC diagnostic plots (trace, forest) in the terminal")
    .option("--kind <kind>", `plot type: ${KINDS.join(" | ")}`, "forest")
    .option("--var <name...>", "restrict to these variables (default: all)")
    .option("--store <dir>", "run store directory (default: nearest .mcmc above cwd)")
    .option("--width <cells>", "plot width in characters", parseIntOption)
    .option("--height <cells>", "plot height in characters (trace)", parseIntOption)
    .option("--ascii", "use ASCII glyphs instead of Unicode braille/blocks")
    .option("--hdi-prob <value>", "HDI credible mass (forest)", parseFloatOption, 0.94)
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
        const traces = variables.map((v) => traceData(samples, v));
        data = traces.length === 1 ? traces[0] : traces;
        rendered = traces.map((t) => renderTraceTerminal(t, term)).join("\n");
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
