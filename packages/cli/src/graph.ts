import { readFileSync, writeFileSync } from "node:fs";
import { basename, extname } from "node:path";
import { loadDataFile } from "@mcmcjs/core";
import type { UnifiedModelData } from "@mcmcjs/doodleppl";
import { BugsSyntaxError, type ParseWarning, parseBugs } from "@mcmcjs/doodleppl/parse";
import { applyLayout, layoutGraph, renderGraphSvg } from "@mcmcjs/doodleppl/render";
import type { Command } from "commander";
import pc from "picocolors";

const FORMATS = ["svg", "png", "json"] as const;
type Format = (typeof FORMATS)[number];

export interface GraphOptions {
  format: Format;
  out?: string;
  data?: string;
  theme: "tokens" | "light" | "dark";
  direction: "TB" | "LR";
  scale: number;
}

/** Read a BUGS program, or a graph document already in the editor's format. */
export function loadGraph(
  file: string,
  dataKeys: Iterable<string> = [],
): { model: UnifiedModelData; warnings: ParseWarning[] } {
  const text = readFileSync(file, "utf8");
  if (extname(file) === ".json") {
    return { model: JSON.parse(text) as UnifiedModelData, warnings: [] };
  }
  const name = basename(file).replace(/\.[^.]+$/, "");
  return parseBugs(text, { name, dataKeys });
}

export async function renderGraph(
  model: UnifiedModelData,
  opts: GraphOptions,
): Promise<string | Uint8Array> {
  const elements = model.elements ?? model.graphJSON ?? [];
  const layout = layoutGraph(elements, { rankdir: opts.direction });
  if (opts.format === "json") {
    return `${JSON.stringify({ ...model, elements: applyLayout(elements, layout) }, null, 2)}\n`;
  }
  // A rasterizer cannot resolve CSS variables, so PNG needs concrete colours.
  const theme = opts.format === "png" && opts.theme === "tokens" ? "light" : opts.theme;
  const svg = renderGraphSvg(layout, { theme });
  if (opts.format === "svg") return svg;
  return rasterize(svg, opts.scale);
}

interface ResvgModule {
  Resvg: new (svg: string, options: object) => { render(): { asPng(): Uint8Array } };
}

async function rasterize(svg: string, scale: number): Promise<Uint8Array> {
  // Optional: a native binding, which the single-file binary does not carry.
  let resvg: ResvgModule;
  try {
    resvg = (await import("@resvg/resvg-js")) as unknown as ResvgModule;
  } catch {
    throw new Error(
      "PNG output needs @resvg/resvg-js, which is not installed here; use --format svg, or install it with your package manager",
    );
  }
  const width = Number(/width="(\d+)"/.exec(svg)?.[1] ?? 800);
  return new resvg.Resvg(svg, { fitTo: { mode: "width", value: Math.round(width * scale) } })
    .render()
    .asPng();
}

export function registerGraph(program: Command): void {
  program
    .command("graph <model>")
    .summary("draw a BUGS model as a graph")
    .helpGroup("Start a project:")
    .description(
      "Read a BUGS program (or a DoodlePPL graph .json) and draw its graphical model: " +
        "plates for loops, shaded observed nodes, dashed deterministic ones",
    )
    .option("--format <fmt>", `output format: ${FORMATS.join(" | ")}`, "svg")
    .option("-o, --out <file>", "write to a file instead of stdout")
    .option("--data <file>", "data file (JSON or TOML); its variables are drawn as observed")
    .option("--theme <theme>", "svg colours: tokens (CSS variables) | light | dark", "tokens")
    .option("--direction <dir>", "layout direction: TB (top to bottom) | LR", "TB")
    .option("--scale <n>", "png pixel scale", "2")
    .action(async (file: string, raw: Record<string, string | undefined>) => {
      const format = raw.format as Format;
      if (!FORMATS.includes(format)) {
        process.stderr.write(
          `unknown --format "${raw.format}"; expected one of: ${FORMATS.join(", ")}\n`,
        );
        process.exitCode = 1;
        return;
      }
      const opts: GraphOptions = {
        format,
        out: raw.out,
        data: raw.data,
        theme: (raw.theme as GraphOptions["theme"]) ?? "tokens",
        direction: (raw.direction as GraphOptions["direction"]) ?? "TB",
        scale: Number(raw.scale ?? 2),
      };

      let dataKeys: string[] = [];
      if (opts.data) dataKeys = Object.keys(loadDataFile(opts.data));

      let model: UnifiedModelData;
      let warnings: ParseWarning[];
      try {
        ({ model, warnings } = loadGraph(file, dataKeys));
      } catch (error) {
        if (error instanceof BugsSyntaxError) {
          process.stderr.write(`${pc.red("syntax error")} ${error.message}\n`);
          process.exitCode = 1;
          return;
        }
        throw error;
      }
      for (const w of warnings)
        process.stderr.write(`${pc.yellow("warning")} line ${w.line}: ${w.message}\n`);

      let content: string | Uint8Array;
      try {
        content = await renderGraph(model, opts);
      } catch (error) {
        process.stderr.write(`${pc.red("error")} ${(error as Error).message}\n`);
        process.exitCode = 1;
        return;
      }

      if (opts.out) {
        writeFileSync(opts.out, content);
        process.stdout.write(`wrote ${format} graph to ${opts.out}\n`);
      } else {
        process.stdout.write(content);
      }
    });
}
