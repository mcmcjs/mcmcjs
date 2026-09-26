// Automatic layout for a graph document with dagre. Plates are compound nodes,
// so dagre sizes each one around its members; a node that depends on itself at
// another index keeps its edge and dagre routes it as a loop.

import dagre from "@dagrejs/dagre";
import type { GraphEdge, GraphElement, GraphNode } from "../core/types";

export interface LayoutOptions {
  /** Top to bottom (the WinBUGS convention) or left to right. */
  rankdir?: "TB" | "LR";
  nodesep?: number;
  ranksep?: number;
}

export interface Point {
  x: number;
  y: number;
}

/** A node with its centre and size. */
export interface PlacedNode extends Point {
  node: GraphNode;
  width: number;
  height: number;
}

export interface PlacedEdge {
  edge: GraphEdge;
  points: Point[];
}

export interface Layout {
  width: number;
  height: number;
  nodes: PlacedNode[];
  /** Plates, outermost first, so they paint behind their children. */
  plates: PlacedNode[];
  edges: PlacedEdge[];
}

const NODE_HEIGHT = 40;
const CHAR_WIDTH = 7.4;
const PLATE_PADDING = 28;

/** The text drawn inside a node: its name, with subscripts when it has them. */
export function nodeLabel(node: GraphNode): string {
  return node.indices ? `${node.name}[${node.indices}]` : node.name;
}

const nodeWidth = (node: GraphNode) => Math.max(60, nodeLabel(node).length * CHAR_WIDTH + 24);

export function layoutGraph(elements: GraphElement[], options: LayoutOptions = {}): Layout {
  const nodes = elements.filter((e): e is GraphNode => e.type === "node");
  const edges = elements.filter((e): e is GraphEdge => e.type === "edge");
  const byId = new Map(nodes.map((n) => [n.id, n]));

  const g = new dagre.graphlib.Graph({ compound: true, directed: true, multigraph: false });
  g.setGraph({
    rankdir: options.rankdir ?? "TB",
    nodesep: options.nodesep ?? 36,
    ranksep: options.ranksep ?? 48,
    marginx: 20,
    marginy: 20,
  });
  g.setDefaultEdgeLabel(() => ({}));

  for (const n of nodes) {
    if (n.nodeType === "plate") {
      // Room for the loop label drawn inside the plate's bottom edge.
      g.setNode(n.id, {
        width: 0,
        height: 0,
        paddingLeft: PLATE_PADDING,
        paddingRight: PLATE_PADDING,
        paddingTop: PLATE_PADDING,
        paddingBottom: PLATE_PADDING + 8,
      });
    } else {
      g.setNode(n.id, { width: nodeWidth(n), height: NODE_HEIGHT });
    }
  }
  for (const n of nodes) {
    if (n.parent && byId.has(n.parent)) g.setParent(n.id, n.parent);
  }
  for (const e of edges) {
    if (byId.has(e.source) && byId.has(e.target)) g.setEdge(e.source, e.target);
  }

  dagre.layout(g);

  const placed = (n: GraphNode): PlacedNode => {
    const l = g.node(n.id);
    return { node: n, x: l.x ?? 0, y: l.y ?? 0, width: l.width, height: l.height };
  };

  const depth = (n: GraphNode): number => {
    let d = 0;
    for (
      let p = n.parent ? byId.get(n.parent) : undefined;
      p;
      p = p.parent ? byId.get(p.parent) : undefined
    )
      d++;
    return d;
  };
  const plates = nodes
    .filter((n) => n.nodeType === "plate")
    .sort((a, b) => depth(a) - depth(b))
    .map(placed);

  const label = g.graph();
  return {
    width: label.width ?? 0,
    height: label.height ?? 0,
    nodes: nodes.filter((n) => n.nodeType !== "plate").map(placed),
    plates,
    edges: edges
      .filter((e) => byId.has(e.source) && byId.has(e.target))
      .map((e) => ({ edge: e, points: g.edge(e.source, e.target).points ?? [] })),
  };
}

/** The same elements with `position` set from a layout, for the editor to open as drawn. */
export function applyLayout(elements: GraphElement[], layout: Layout): GraphElement[] {
  const pos = new Map<string, Point>();
  for (const p of [...layout.nodes, ...layout.plates]) pos.set(p.node.id, { x: p.x, y: p.y });
  return elements.map((e) => {
    const at = e.type === "node" ? pos.get(e.id) : undefined;
    return at ? { ...e, position: { x: Math.round(at.x), y: Math.round(at.y) } } : e;
  });
}
