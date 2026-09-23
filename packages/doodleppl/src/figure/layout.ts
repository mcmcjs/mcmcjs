// Place a graph document's nodes and plates on a page, in centimetres with y
// pointing down, ready for the TikZ and SVG writers. The node positions come from
// the document itself, so the figure keeps the arrangement drawn in the editor.

import { getElements } from "../core/model";
import type { GraphEdge, GraphElement, GraphNode, UnifiedModelData } from "../core/types";
import { type Label, nodeLabel } from "./label";

export type FigureNodeKind = "stochastic" | "observed" | "deterministic" | "constant";

export interface FigureNode {
  id: string;
  kind: FigureNodeKind;
  label: Label;
  x: number;
  y: number;
}

export interface FigurePlate {
  id: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** The loop index, e.g. `i`. */
  variable: string;
  /** The loop bounds, e.g. `["1", "N"]`, or the raw range when it has no colon. */
  range: [string, string] | string;
}

export interface FigureEdge {
  from: string;
  to: string;
}

export interface FigureLayout {
  name: string;
  nodes: FigureNode[];
  plates: FigurePlate[];
  edges: FigureEdge[];
  width: number;
  height: number;
  /** Diameter of a node, and side of a constant's square, in centimetres. */
  nodeSize: number;
}

export interface FigureOptions {
  /** Distance between a node and its nearest neighbour, in centimetres. */
  spacing?: number;
  /** Node diameter in centimetres. */
  nodeSize?: number;
}

const PLATE_PAD = 0.22;
const PLATE_LABEL = 0.42;
const MARGIN = 0.08;

function kindOf(node: GraphNode): FigureNodeKind {
  if (node.nodeType === "observed" || node.observed) return "observed";
  if (node.nodeType === "deterministic") return "deterministic";
  if (node.nodeType === "constant") return "constant";
  return "stochastic";
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? (sorted[mid] as number)
    : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

/** How far apart the document's nodes typically are, from each node's nearest neighbour. */
function typicalSpacing(points: { x: number; y: number }[]): number {
  if (points.length < 2) return 100;
  const nearest = points.map((p, i) => {
    let best = Number.POSITIVE_INFINITY;
    points.forEach((q, j) => {
      if (i !== j) best = Math.min(best, Math.hypot(p.x - q.x, p.y - q.y));
    });
    return best;
  });
  const typical = median(nearest.filter((d) => d > 0));
  return Number.isFinite(typical) && typical > 0 ? typical : 100;
}

function plateRange(range: string | undefined): [string, string] | string {
  const raw = (range ?? "").trim();
  const colon = raw.indexOf(":");
  return colon > 0 ? [raw.slice(0, colon).trim(), raw.slice(colon + 1).trim()] : raw;
}

export function figureLayout(
  input: UnifiedModelData | GraphElement[],
  options: FigureOptions = {},
): FigureLayout {
  const elements = Array.isArray(input) ? input : getElements(input);
  const name = Array.isArray(input) ? "graph" : input.name;
  const spacing = options.spacing ?? 1.5;
  const nodeSize = options.nodeSize ?? 0.75;
  const half = nodeSize / 2;

  const graphNodes = elements.filter(
    (el): el is GraphNode => el.type === "node" && el.nodeType !== "plate",
  );
  const plateNodes = elements.filter(
    (el): el is GraphNode => el.type === "node" && el.nodeType === "plate",
  );
  if (graphNodes.length === 0) throw new Error("graph has no nodes to draw");
  for (const node of graphNodes) {
    if (!node.position) {
      throw new Error(
        `node "${node.name}" has no position; open the graph in DoodlePPL, or give every node a position`,
      );
    }
  }
  const parentOf = new Map(graphNodes.map((n) => [n.id, n.parent]));

  const scale =
    spacing / typicalSpacing(graphNodes.map((n) => n.position as { x: number; y: number }));
  const nodes: FigureNode[] = graphNodes.map((node) => ({
    id: node.id,
    kind: kindOf(node),
    label: nodeLabel(node.name, node.indices),
    x: (node.position as { x: number }).x * scale,
    y: (node.position as { y: number }).y * scale,
  }));

  // Plates are boxes around their members, so an inner plate is sized before the plate around it.
  const depth = (plate: GraphNode): number => {
    let d = 0;
    let parent = plate.parent;
    while (parent) {
      d += 1;
      parent = plateNodes.find((p) => p.id === parent)?.parent;
    }
    return d;
  };
  const boxes = new Map<string, FigurePlate>();
  for (const plate of [...plateNodes].sort((a, b) => depth(b) - depth(a))) {
    const members = nodes.filter((n) => parentOf.get(n.id) === plate.id);
    const inner = plateNodes
      .filter((p) => p.parent === plate.id)
      .map((p) => boxes.get(p.id))
      .filter((b): b is FigurePlate => b !== undefined);
    if (members.length === 0 && inner.length === 0) continue;
    const xs0 = [...members.map((n) => n.x - half), ...inner.map((b) => b.x0)];
    const xs1 = [...members.map((n) => n.x + half), ...inner.map((b) => b.x1)];
    const ys0 = [...members.map((n) => n.y - half), ...inner.map((b) => b.y0)];
    const ys1 = [...members.map((n) => n.y + half), ...inner.map((b) => b.y1)];
    boxes.set(plate.id, {
      id: plate.id,
      x0: Math.min(...xs0) - PLATE_PAD,
      x1: Math.max(...xs1) + PLATE_PAD,
      y0: Math.min(...ys0) - PLATE_PAD,
      // Room under the lowest member for the loop label.
      y1: Math.max(...ys1) + PLATE_PAD + PLATE_LABEL,
      variable: plate.loopVariable || "i",
      range: plateRange(plate.loopRange),
    });
  }
  const plates = plateNodes
    .map((p) => boxes.get(p.id))
    .filter((b): b is FigurePlate => b !== undefined);

  // Shift everything so the drawing starts at the margin.
  const minX = Math.min(...nodes.map((n) => n.x - half), ...plates.map((p) => p.x0));
  const minY = Math.min(...nodes.map((n) => n.y - half), ...plates.map((p) => p.y0));
  const dx = MARGIN - minX;
  const dy = MARGIN - minY;
  for (const n of nodes) {
    n.x += dx;
    n.y += dy;
  }
  for (const p of plates) {
    p.x0 += dx;
    p.x1 += dx;
    p.y0 += dy;
    p.y1 += dy;
  }
  const width = Math.max(...nodes.map((n) => n.x + half), ...plates.map((p) => p.x1)) + MARGIN;
  const height = Math.max(...nodes.map((n) => n.y + half), ...plates.map((p) => p.y1)) + MARGIN;

  const ids = new Set(nodes.map((n) => n.id));
  const edges = elements
    .filter((el): el is GraphEdge => el.type === "edge")
    .filter((e) => ids.has(e.source) && ids.has(e.target))
    .map((e) => ({ from: e.source, to: e.target }));

  return { name, nodes, plates, edges, width, height, nodeSize };
}
