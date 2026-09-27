import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseUnifiedModel } from "@mcmcjs/doodleppl";
import { figureSvg, figureTikz } from "@mcmcjs/doodleppl/figure";
import type { Command } from "commander";

const FORMATS = ["tikz", "svg"] as const;
export type FigureFormat = (typeof FORMATS)[number];

export interface FigureOptions {
  format: FigureFormat;
  standalone?: boolean;
}

/** Read a DoodleBUGS graph and draw it as a black-and-white figure. */
export function drawFigure(graphPath: string, opts: FigureOptions): string {
  const model = parseUnifiedModel(readFileSync(resolve(graphPath), "utf8"));
  if (opts.format === "svg") return figureSvg(model);
  return figureTikz(model, { standalone: opts.standalone });
}

function parseFormat(value: string): FigureFormat {
  if ((FORMATS as readonly string[]).includes(value)) return value as FigureFormat;
  throw new Error(`unknown --format "${value}"; expected one of: ${FORMATS.join(", ")}`);
}

export function registerFigure(program: Command): void {
  program
    .command("figure")
    .summary("DoodleBUGS graph -> black-and-white figure")
    .helpGroup("Start a project:")
    .argument("<graph>", "DoodleBUGS graph file (.json)")
    .description(
      "Draw a DoodleBUGS graph as a black-and-white figure for papers, as TikZ for LaTeX or as SVG, keeping the node positions saved in the graph",
    )
    .option("--format <fmt>", `output format: ${FORMATS.join(" | ")}`, parseFormat, "tikz")
    .option(
      "--standalone",
      "wrap the TikZ in a standalone document that pdflatex compiles on its own",
    )
    .option("-o, --out <file>", "write to a file instead of stdout")
    .action(
      (graphPath: string, opts: { format: FigureFormat; standalone?: boolean; out?: string }) => {
        const figure = drawFigure(graphPath, opts);
        if (opts.out) {
          const out = resolve(opts.out);
          mkdirSync(dirname(out), { recursive: true });
          writeFileSync(out, figure);
          process.stdout.write(`wrote ${out}\n`);
        } else {
          process.stdout.write(figure);
        }
        process.exitCode = 0;
      },
    );
}
