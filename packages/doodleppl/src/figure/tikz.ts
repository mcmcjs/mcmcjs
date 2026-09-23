// A graph document as a TikZ picture in the plain black-and-white style of a
// graphical-model figure in a paper.

import type { GraphElement, UnifiedModelData } from "../core/types";
import { labelTex, texEscape } from "./label";
import { type FigureLayout, type FigureOptions, type FigurePlate, figureLayout } from "./layout";

export interface TikzOptions extends FigureOptions {
  /** Wrap the picture in a `standalone` document that pdflatex compiles on its own. */
  standalone?: boolean;
}

const n = (v: number) => v.toFixed(2);

function rangeTex(plate: FigurePlate): string {
  const v = texEscape(plate.variable);
  if (typeof plate.range === "string") {
    return plate.range ? `${v} \\in ${texEscape(plate.range)}` : v;
  }
  const [lo, hi] = plate.range.map(texEscape);
  return `${v} = ${lo}, \\ldots, ${hi}`;
}

/** Render an already computed layout. */
export function layoutToTikz(layout: FigureLayout, options: { standalone?: boolean } = {}): string {
  const size = Math.round(layout.nodeSize * 10);
  const square = Math.round(layout.nodeSize * 0.85 * 10);
  // TikZ reads a dot in a node name as an anchor, so nodes get plain generated names.
  const names = new Map(layout.nodes.map((node, i) => [node.id, `n${i + 1}`]));
  const title = layout.name.replace(/[\r\n]+/g, " ");

  const lines = [
    `% "${title}", drawn by DoodlePPL.`,
    "% Needs \\usepackage{tikz} and \\usetikzlibrary{arrows.meta}.",
    "\\begin{tikzpicture}[",
    `  stochastic/.style={circle, draw, thick, minimum size=${size}mm, inner sep=0pt},`,
    "  observed/.style={stochastic, fill=black!20},",
    "  deterministic/.style={stochastic, double, double distance=1pt},",
    `  constant/.style={rectangle, draw, thick, minimum size=${square}mm, inner sep=2pt},`,
    "  plate/.style={draw, rounded corners=3pt, black!60},",
    "  platelabel/.style={font=\\scriptsize, text=black!60, anchor=south east, inner sep=2pt},",
    "  edge/.style={-{Stealth[length=1.8mm]}, thick}]",
  ];
  for (const plate of layout.plates) {
    lines.push(
      `\\draw[plate] (${n(plate.x0)},${n(-plate.y0)}) rectangle (${n(plate.x1)},${n(-plate.y1)});`,
      `\\node[platelabel] at (${n(plate.x1)},${n(-plate.y1)}) {$${rangeTex(plate)}$};`,
    );
  }
  for (const node of layout.nodes) {
    lines.push(
      `\\node[${node.kind}] (${names.get(node.id)}) at (${n(node.x)},${n(-node.y)}) {$${labelTex(node.label)}$};`,
    );
  }
  for (const edge of layout.edges) {
    lines.push(`\\draw[edge] (${names.get(edge.from)}) -- (${names.get(edge.to)});`);
  }
  lines.push("\\end{tikzpicture}");

  const picture = `${lines.join("\n")}\n`;
  if (!options.standalone) return picture;
  return [
    "\\documentclass[tikz,border=4pt]{standalone}",
    "\\usetikzlibrary{arrows.meta}",
    "\\begin{document}",
    picture.trimEnd(),
    "\\end{document}",
    "",
  ].join("\n");
}

/** A graph document as a TikZ picture, or a standalone LaTeX document with `standalone`. */
export function figureTikz(
  input: UnifiedModelData | GraphElement[],
  options: TikzOptions = {},
): string {
  return layoutToTikz(figureLayout(input, options), options);
}
