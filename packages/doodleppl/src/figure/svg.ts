// A graph document as a standalone black-and-white SVG, drawn to match the TikZ
// output so the same figure can go on a web page or into a document.

import type { GraphElement, UnifiedModelData } from "../core/types";
import { type Label, labelSize, labelText } from "./label";
import {
  type FigureLayout,
  type FigureNode,
  type FigureOptions,
  type FigurePlate,
  figureLayout,
  nodeShape,
} from "./layout";
import { routeCurve } from "./route";

/** SVG user units per centimetre, at the CSS 96 dpi. */
const PX = 96 / 2.54;
const STROKE = 1.2;
const FONT_SIZE = 14;
const FONT = "'Latin Modern Roman', 'CMU Serif', 'STIX Two Text', 'Times New Roman', serif";
/** Gap between the two rings of a deterministic node, either side of its outline, in px. */
const RING = 1.5;

const f = (v: number) => (Math.round(v * 100) / 100).toString();
const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Words in italics, digits and punctuation upright, the way maths is set. */
function mathText(s: string): string {
  return s
    .split(/([A-Za-zͰ-Ͽ]+)/)
    .filter((piece) => piece !== "")
    .map((piece) =>
      /^[A-Za-zͰ-Ͽ]+$/.test(piece)
        ? `<tspan font-style="italic">${esc(piece)}</tspan>`
        : esc(piece),
    )
    .join("");
}

function rangeText(plate: FigurePlate): string {
  if (typeof plate.range === "string") {
    return plate.range ? `${plate.variable} ∈ ${plate.range}` : plate.variable;
  }
  return `${plate.variable} = ${plate.range[0]}, …, ${plate.range[1]}`;
}

function nodeSvg(node: FigureNode): string {
  const cx = node.x * PX;
  const cy = node.y * PX;
  const stroke = `stroke="#000" stroke-width="${STROKE}"`;
  if (node.kind === "constant") {
    const w = node.width * PX;
    const h = node.height * PX;
    return `<rect x="${f(cx - w / 2)}" y="${f(cy - h / 2)}" width="${f(w)}" height="${f(h)}" fill="#fff" ${stroke}/>`;
  }
  const r = (node.width * PX) / 2;
  if (node.kind === "deterministic") {
    return [
      `<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(r + RING)}" fill="#fff" ${stroke}/>`,
      `<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(r - RING)}" fill="none" ${stroke}/>`,
    ].join("\n");
  }
  const fill = node.kind === "observed" ? "#ccc" : "#fff";
  return `<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(r)}" fill="${fill}" ${stroke}/>`;
}

/** The label's text content: the base symbol, then its subscript set small and lowered. */
function labelContent(label: Label): string {
  const { base, subscript } = labelText(label);
  const sub = subscript ? `<tspan dy="0.3em" font-size="70%">${mathText(subscript)}</tspan>` : "";
  return `${mathText(base)}${sub}`;
}

function nodeLabelSvg(node: FigureNode): string {
  return `<text x="${f(node.x * PX)}" y="${f(node.y * PX)}" dy="0.35em" text-anchor="middle">${labelContent(node.label)}</text>`;
}

export interface LabelSvgOptions {
  /** Font size in px. */
  fontSize?: number;
  color?: string;
  /** Draw the image this many times larger than its size, so it stays sharp when zoomed. */
  pixelRatio?: number;
}

/**
 * A name typeset on its own as a small SVG, the way the figure writes it, for use as
 * an image, e.g. on a canvas. `width` and `height` are its size in px.
 */
export function labelSvg(
  label: Label,
  options: LabelSvgOptions = {},
): { svg: string; width: number; height: number } {
  const fontSize = options.fontSize ?? FONT_SIZE;
  const ratio = options.pixelRatio ?? 1;
  // labelSize measures in cm at a 10pt body, which is 40/3 px.
  const width = Math.ceil(labelSize(label).width * PX * (fontSize / (40 / 3)) + fontSize * 0.6);
  const height = Math.ceil(fontSize * 1.8);
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width * ratio}" height="${height * ratio}" viewBox="0 0 ${width} ${height}" font-family="${esc(FONT)}" font-size="${fontSize}" fill="${esc(options.color ?? "#000")}">`,
    `<text x="${f(width / 2)}" y="${f(height / 2)}" dy="0.35em" text-anchor="middle">${labelContent(label)}</text>`,
    "</svg>",
  ].join("");
  return { svg, width, height };
}

/** A line of maths, such as a plate's `i = 1, …, N`, typeset on its own as a small SVG. */
export function mathSvg(
  text: string,
  options: LabelSvgOptions = {},
): { svg: string; width: number; height: number } {
  return labelSvg({ base: { text, greek: false }, subscript: [] }, options);
}

/** Render an already computed layout. */
export function layoutToSvg(layout: FigureLayout): string {
  const w = Math.ceil(layout.width * PX);
  const h = Math.ceil(layout.height * PX);
  const byId = new Map(layout.nodes.map((node) => [node.id, node]));
  // An arrow stops at a deterministic node's outer ring.
  const outlineOf = (node: FigureNode) =>
    nodeShape(node, node.kind === "deterministic" ? RING / PX : 0);
  const out = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" font-family="${esc(FONT)}" font-size="${FONT_SIZE}">`,
    `<title>${esc(layout.name)}</title>`,
    '<defs><marker id="doodleppl-arrow" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M 0 0 L 10 5 L 0 10 L 3 5 z" fill="#000"/></marker></defs>',
    `<rect width="${w}" height="${h}" fill="#fff"/>`,
  ];
  for (const plate of layout.plates) {
    const x0 = plate.x0 * PX;
    const y0 = plate.y0 * PX;
    out.push(
      `<rect x="${f(x0)}" y="${f(y0)}" width="${f((plate.x1 - plate.x0) * PX)}" height="${f((plate.y1 - plate.y0) * PX)}" rx="4" fill="none" stroke="#666" stroke-width="1"/>`,
      plate.labelSide === "right"
        ? `<text x="${f(plate.x1 * PX - 4)}" y="${f(plate.y1 * PX - 5)}" text-anchor="end" font-size="9" fill="#666">${mathText(rangeText(plate))}</text>`
        : `<text x="${f(plate.x0 * PX + 4)}" y="${f(plate.y1 * PX - 5)}" font-size="9" fill="#666">${mathText(rangeText(plate))}</text>`,
    );
  }
  const edgeStyle = `fill="none" stroke="#000" stroke-width="${STROKE}" marker-end="url(#doodleppl-arrow)"`;
  for (const edge of layout.edges) {
    const a = byId.get(edge.from) as FigureNode;
    const b = byId.get(edge.to) as FigureNode;
    const { start, c1, c2, end } = routeCurve(outlineOf(a), outlineOf(b), edge);
    const p = (q: { x: number; y: number }) => `${f(q.x * PX)} ${f(q.y * PX)}`;
    if (edge.bend === 0 && edge.out === undefined) {
      // Outlines that touch leave no line to draw.
      if ((end.x - start.x) * (b.x - a.x) + (end.y - start.y) * (b.y - a.y) <= 0) continue;
      out.push(
        `<line x1="${f(start.x * PX)}" y1="${f(start.y * PX)}" x2="${f(end.x * PX)}" y2="${f(end.y * PX)}" ${edgeStyle}/>`,
      );
    } else {
      out.push(`<path d="M ${p(start)} C ${p(c1)} ${p(c2)} ${p(end)}" ${edgeStyle}/>`);
    }
  }
  for (const node of layout.nodes) out.push(nodeSvg(node), nodeLabelSvg(node));
  out.push("</svg>");
  return `${out.join("\n")}\n`;
}

/** A graph document as a standalone black-and-white SVG. */
export function figureSvg(
  input: UnifiedModelData | GraphElement[],
  options: FigureOptions = {},
): string {
  return layoutToSvg(figureLayout(input, options));
}
