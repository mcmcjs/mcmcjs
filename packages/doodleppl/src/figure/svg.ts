// A graph document as a standalone black-and-white SVG, drawn to match the TikZ
// output so the same figure can go on a web page or into a document.

import type { GraphElement, UnifiedModelData } from "../core/types";
import { labelText } from "./label";
import {
  type FigureLayout,
  type FigureNode,
  type FigureOptions,
  type FigurePlate,
  figureLayout,
} from "./layout";

/** SVG user units per centimetre, at the CSS 96 dpi. */
const PX = 96 / 2.54;
const STROKE = 1.2;
const FONT_SIZE = 14;
const FONT = "'Latin Modern Roman', 'CMU Serif', 'STIX Two Text', 'Times New Roman', serif";

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

/** A rough label width in px, so an outline can grow to fit a long name as TikZ does. */
function labelWidth(node: FigureNode): number {
  const { base, subscript } = labelText(node.label);
  return (base.length + subscript.length * 0.7) * FONT_SIZE * 0.55;
}

/** Half-width and half-height of a constant's box, or the radius twice for a circle. */
function extent(node: FigureNode, size: number): [number, number] {
  const width = labelWidth(node);
  if (node.kind === "constant") {
    const half = (size * 0.85 * PX) / 2;
    return [Math.max(half, width / 2 + 4), half];
  }
  const r = Math.max((size * PX) / 2, width / 2 + 3);
  return [r, r];
}

/** Distance from a node's centre to its outline along a unit direction. */
function reach(node: FigureNode, ux: number, uy: number, size: number): number {
  const [hw, hh] = extent(node, size);
  if (node.kind === "constant") {
    return Math.min(hw / Math.abs(ux || 1e-9), hh / Math.abs(uy || 1e-9));
  }
  return hw + (node.kind === "deterministic" ? 1.5 : 0);
}

function nodeShape(node: FigureNode, size: number): string {
  const cx = node.x * PX;
  const cy = node.y * PX;
  const [hw, hh] = extent(node, size);
  const stroke = `stroke="#000" stroke-width="${STROKE}"`;
  if (node.kind === "constant") {
    return `<rect x="${f(cx - hw)}" y="${f(cy - hh)}" width="${f(2 * hw)}" height="${f(2 * hh)}" fill="#fff" ${stroke}/>`;
  }
  const r = hw;
  const fill = node.kind === "observed" ? "#ccc" : "#fff";
  if (node.kind === "deterministic") {
    return [
      `<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(r + 1.5)}" fill="#fff" ${stroke}/>`,
      `<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(r - 1.5)}" fill="none" ${stroke}/>`,
    ].join("\n");
  }
  return `<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(r)}" fill="${fill}" ${stroke}/>`;
}

function nodeLabelSvg(node: FigureNode): string {
  const { base, subscript } = labelText(node.label);
  const sub = subscript ? `<tspan dy="0.3em" font-size="70%">${mathText(subscript)}</tspan>` : "";
  return `<text x="${f(node.x * PX)}" y="${f(node.y * PX)}" dy="0.35em" text-anchor="middle">${mathText(base)}${sub}</text>`;
}

/** Render an already computed layout. */
export function layoutToSvg(layout: FigureLayout): string {
  // A name wider than the node size widens its outline, so the canvas grows to fit it.
  let left = 0;
  let right = layout.width * PX;
  for (const node of layout.nodes) {
    const [hw] = extent(node, layout.nodeSize);
    left = Math.min(left, node.x * PX - hw - 3);
    right = Math.max(right, node.x * PX + hw + 3);
  }
  const x = Math.floor(left);
  const w = Math.ceil(right) - x;
  const h = Math.ceil(layout.height * PX);
  const byId = new Map(layout.nodes.map((node) => [node.id, node]));
  const out = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${x} 0 ${w} ${h}" font-family="${esc(FONT)}" font-size="${FONT_SIZE}">`,
    `<title>${esc(layout.name)}</title>`,
    '<defs><marker id="doodleppl-arrow" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M 0 0 L 10 5 L 0 10 L 3 5 z" fill="#000"/></marker></defs>',
    `<rect x="${x}" width="${w}" height="${h}" fill="#fff"/>`,
  ];
  for (const plate of layout.plates) {
    const x0 = plate.x0 * PX;
    const y0 = plate.y0 * PX;
    out.push(
      `<rect x="${f(x0)}" y="${f(y0)}" width="${f((plate.x1 - plate.x0) * PX)}" height="${f((plate.y1 - plate.y0) * PX)}" rx="4" fill="none" stroke="#666" stroke-width="1"/>`,
      `<text x="${f(plate.x1 * PX - 4)}" y="${f(plate.y1 * PX - 5)}" text-anchor="end" font-size="9" fill="#666">${mathText(rangeText(plate))}</text>`,
    );
  }
  for (const edge of layout.edges) {
    const a = byId.get(edge.from) as FigureNode;
    const b = byId.get(edge.to) as FigureNode;
    const dx = (b.x - a.x) * PX;
    const dy = (b.y - a.y) * PX;
    const len = Math.hypot(dx, dy);
    if (len === 0) continue;
    const ux = dx / len;
    const uy = dy / len;
    const start = reach(a, ux, uy, layout.nodeSize);
    const end = reach(b, -ux, -uy, layout.nodeSize);
    if (start + end >= len) continue;
    out.push(
      `<line x1="${f(a.x * PX + ux * start)}" y1="${f(a.y * PX + uy * start)}" x2="${f(b.x * PX - ux * end)}" y2="${f(b.y * PX - uy * end)}" stroke="#000" stroke-width="${STROKE}" marker-end="url(#doodleppl-arrow)"/>`,
    );
  }
  for (const node of layout.nodes) {
    out.push(nodeShape(node, layout.nodeSize), nodeLabelSvg(node));
  }
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
