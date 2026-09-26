// Place a graph document's nodes and plates on a page, in centimetres with y
// pointing down, ready for the TikZ and SVG writers. The node positions come from
// the document itself, so the figure keeps the arrangement drawn in the editor,
// moved only as far as needed so nothing overlaps.

import { getElements } from "../core/model";
import type { GraphEdge, GraphElement, GraphNode, UnifiedModelData } from "../core/types";
import { circle, distanceTo, type Point, rect, type Shape } from "./geometry";
import { type Label, labelSize, nodeLabel } from "./label";
import {
  angleOf,
  chooseRoute,
  closest,
  type EdgeRoute,
  edgeCurve,
  endDirections,
  routeCurve,
  samplePoints,
  spreadAngles,
} from "./route";
import { type Body, separate } from "./separate";

export type FigureNodeKind = "stochastic" | "observed" | "deterministic" | "constant";

export interface FigureNode {
  id: string;
  kind: FigureNodeKind;
  label: Label;
  x: number;
  y: number;
  /** Outline size in centimetres, larger than the node size when the name needs it. */
  width: number;
  height: number;
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
  /** The bottom corner the loop label sits in. */
  labelSide: PlateLabelSide;
}

export type PlateLabelSide = "left" | "right";

/**
 * An edge, bent or turned to pass around what is in its way, and turned to meet its
 * nodes away from other edges.
 */
export interface FigureEdge extends EdgeRoute {
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
  /** Smallest node diameter in centimetres. A constant's square side is 0.85 of it. */
  nodeSize: number;
}

export interface FigureOptions {
  /** Distance between a node and its nearest neighbour, in centimetres. */
  spacing?: number;
  /** Node diameter in centimetres. */
  nodeSize?: number;
}

/** Space between a name and its node's outline: TikZ's `inner sep=2pt`. */
export const INNER_SEP = 0.07;
const PLATE_PAD = 0.22;
const PLATE_LABEL = 0.42;
/** Width of one character of a plate's loop label, set small. */
const PLATE_LABEL_CHAR = 0.14;
const MARGIN = 0.08;
/** Space kept between neighbouring nodes and plates. */
const GAP = 0.4;
/** Space kept between an edge and a node or label it passes. */
const CLEARANCE = 0.1;
/** Smallest angle in degrees between two edges where they meet a node. */
const PORT_GAP = 20;

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

/** Width of a plate's loop label, `i = 1, ..., N`, in centimetres. */
function plateLabelWidth(plate: FigurePlate): number {
  const { variable, range } = plate;
  const length =
    typeof range === "string"
      ? variable.length + (range ? 3 + range.length : 0)
      : variable.length + 3 + range[0].length + 5 + range[1].length;
  return length * PLATE_LABEL_CHAR;
}

/** The area a plate's loop label covers in one of its bottom corners. */
function labelBox(plate: FigurePlate, side: PlateLabelSide): Shape {
  const width = plateLabelWidth(plate) + 2 * INNER_SEP;
  return side === "right"
    ? rect(plate.x1 - width, plate.y1 - 0.35, plate.x1, plate.y1)
    : rect(plate.x0, plate.y1 - 0.35, plate.x0 + width, plate.y1);
}

/** The node's outline: a circle that grows to fit its name, or a box for a constant. */
export function nodeShape(node: FigureNode, grow = 0): Shape {
  if (node.kind === "constant") {
    return rect(
      node.x - node.width / 2 - grow,
      node.y - node.height / 2 - grow,
      node.x + node.width / 2 + grow,
      node.y + node.height / 2 + grow,
    );
  }
  return circle(node.x, node.y, node.width / 2 + grow);
}

function outline(kind: FigureNodeKind, label: Label, size: number) {
  const text = labelSize(label);
  if (kind === "constant") {
    const side = size * 0.85;
    return {
      width: Math.max(side, text.width + 2 * INNER_SEP),
      height: Math.max(side, text.height + 2 * INNER_SEP),
    };
  }
  // As TikZ draws it: a circle through the corners of the name's box, padded by the inner sep.
  const d = Math.max(size, 2 * Math.hypot(text.width / 2 + INNER_SEP, text.height / 2 + INNER_SEP));
  return { width: d, height: d };
}

export function figureLayout(
  input: UnifiedModelData | GraphElement[],
  options: FigureOptions = {},
): FigureLayout {
  const elements = Array.isArray(input) ? input : getElements(input);
  const name = Array.isArray(input) ? "graph" : input.name;
  const spacing = options.spacing ?? 1.5;
  const nodeSize = options.nodeSize ?? 0.8;

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
  const plateIds = new Set(plateNodes.map((p) => p.id));
  const scopeOf = (el: GraphNode) => (el.parent && plateIds.has(el.parent) ? el.parent : undefined);
  const plateParent = new Map(plateNodes.map((p) => [p.id, scopeOf(p)]));
  const nodeParent = new Map(graphNodes.map((n) => [n.id, scopeOf(n)]));
  /** Whether the scope `start` is the plate `plateId` or lies inside it. */
  const inside = (start: string | undefined, plateId: string) => {
    for (let s = start; s; s = plateParent.get(s)) if (s === plateId) return true;
    return false;
  };

  const scale =
    spacing / typicalSpacing(graphNodes.map((n) => n.position as { x: number; y: number }));
  const nodes: FigureNode[] = graphNodes.map((node) => {
    const kind = kindOf(node);
    const label = nodeLabel(node.name, node.indices);
    return {
      id: node.id,
      kind,
      label,
      x: (node.position as { x: number }).x * scale,
      y: (node.position as { y: number }).y * scale,
      ...outline(kind, label, nodeSize),
    };
  });

  const boxes = new Map<string, FigurePlate>();
  const moveGroup = (plateId: string, dx: number, dy: number) => {
    for (const n of nodes) {
      if (inside(nodeParent.get(n.id), plateId)) {
        n.x += dx;
        n.y += dy;
      }
    }
    for (const [id, box] of boxes) {
      if (inside(id, plateId)) {
        box.x0 += dx;
        box.x1 += dx;
        box.y0 += dy;
        box.y1 += dy;
      }
    }
  };

  const plateBox = (plate: GraphNode): FigurePlate | undefined => {
    const members = nodes.filter((n) => nodeParent.get(n.id) === plate.id);
    const inner = plateNodes
      .filter((p) => plateParent.get(p.id) === plate.id)
      .map((p) => boxes.get(p.id))
      .filter((b): b is FigurePlate => b !== undefined);
    if (members.length === 0 && inner.length === 0) return undefined;
    const box: FigurePlate = {
      id: plate.id,
      x0: Math.min(...members.map((n) => n.x - n.width / 2), ...inner.map((b) => b.x0)) - PLATE_PAD,
      x1: Math.max(...members.map((n) => n.x + n.width / 2), ...inner.map((b) => b.x1)) + PLATE_PAD,
      y0:
        Math.min(...members.map((n) => n.y - n.height / 2), ...inner.map((b) => b.y0)) - PLATE_PAD,
      // Room under the lowest member for the loop label.
      y1:
        Math.max(...members.map((n) => n.y + n.height / 2), ...inner.map((b) => b.y1)) +
        PLATE_PAD +
        PLATE_LABEL,
      variable: plate.loopVariable || "i",
      range: plateRange(plate.loopRange),
      labelSide: "right",
    };
    // A narrow plate widens evenly on both sides to fit its loop label.
    const short = plateLabelWidth(box) + 2 * PLATE_PAD - (box.x1 - box.x0);
    if (short > 0) {
      box.x0 -= short / 2;
      box.x1 += short / 2;
    }
    return box;
  };

  // Settle the innermost plates first, so each plate then moves as one block among its siblings.
  const settle = (scope: string | undefined) => {
    const childPlates = plateNodes.filter((p) => plateParent.get(p.id) === scope);
    for (const plate of childPlates) settle(plate.id);
    const bodies: Body[] = [
      ...nodes
        .filter((n) => nodeParent.get(n.id) === scope)
        .map((n) => ({
          shape: () => nodeShape(n),
          move: (dx: number, dy: number) => {
            n.x += dx;
            n.y += dy;
          },
        })),
      ...childPlates
        .filter((p) => boxes.has(p.id))
        .map((p) => {
          const box = boxes.get(p.id) as FigurePlate;
          return {
            shape: () => rect(box.x0, box.y0, box.x1, box.y1),
            move: (dx: number, dy: number) => moveGroup(p.id, dx, dy),
          };
        }),
    ];
    separate(bodies, GAP);
    const plate = plateNodes.find((p) => p.id === scope);
    const box = plate && plateBox(plate);
    if (box) boxes.set(box.id, box);
  };
  settle(undefined);

  const plates = plateNodes
    .map((p) => boxes.get(p.id))
    .filter((b): b is FigurePlate => b !== undefined);

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const links = elements
    .filter((el): el is GraphEdge => el.type === "edge")
    .filter((e) => byId.has(e.source) && byId.has(e.target) && e.source !== e.target)
    .map((e) => ({ a: byId.get(e.source) as FigureNode, b: byId.get(e.target) as FigureNode }));
  const straightLines = links.map(({ a, b }) =>
    samplePoints(edgeCurve(nodeShape(a), nodeShape(b), 0)),
  );

  // A loop label sits bottom right, or bottom left when fewer straight edges cross it there.
  for (const p of plates) {
    const crossings = (side: PlateLabelSide) => {
      const box = labelBox(p, side);
      return straightLines.filter((line) => line.some((q) => distanceTo(box, q) < CLEARANCE))
        .length;
    };
    const right = crossings("right");
    if (right > 0 && crossings("left") < right) p.labelSide = "left";
  }
  const labels = plates.map((p) => labelBox(p, p.labelSide));

  // Edges that run clear stay straight. The rest bend or turn, each meeting its nodes
  // away from the edges already drawn there.
  const obstaclesFor = (a: FigureNode, b: FigureNode) => [
    ...nodes.filter((n) => n !== a && n !== b).map((n) => nodeShape(n)),
    ...labels,
  ];
  const curveOf = (a: FigureNode, b: FigureNode, route: EdgeRoute) =>
    routeCurve(nodeShape(a), nodeShape(b), route);
  const routes: EdgeRoute[] = links.map(({ a, b }) =>
    chooseRoute(nodeShape(a), nodeShape(b), obstaclesFor(a, b), CLEARANCE),
  );
  const straight = (r: EdgeRoute) => r.bend === 0 && r.out === undefined;
  const taken = new Map<string, Point[]>();
  const record = (a: FigureNode, b: FigureNode, route: EdgeRoute) => {
    const ends = endDirections(curveOf(a, b, route));
    taken.set(a.id, [...(taken.get(a.id) ?? []), ends.start]);
    taken.set(b.id, [...(taken.get(b.id) ?? []), ends.end]);
  };
  links.forEach(({ a, b }, i) => {
    if (straight(routes[i] as EdgeRoute)) record(a, b, routes[i] as EdgeRoute);
  });
  links.forEach(({ a, b }, i) => {
    if (straight(routes[i] as EdgeRoute)) return;
    const route = chooseRoute(nodeShape(a), nodeShape(b), obstaclesFor(a, b), CLEARANCE, {
      start: taken.get(a.id) ?? [],
      end: taken.get(b.id) ?? [],
    });
    routes[i] = route;
    record(a, b, route);
  });

  // Where edges would meet a node less than 20 degrees apart, their ends move round
  // the outline, so arrow heads and lines do not land on each other. An edge that
  // would then pass too close to a node keeps its ends.
  const natural = links.map(({ a, b }, i) => {
    const ends = endDirections(curveOf(a, b, routes[i] as EdgeRoute));
    return { out: angleOf(ends.start), in: angleOf(ends.end) };
  });
  const moved: { out?: number; in?: number }[] = links.map(() => ({}));
  const atNode = new Map<string, { edge: number; side: "out" | "in" }[]>();
  links.forEach(({ a, b }, i) => {
    atNode.set(a.id, [...(atNode.get(a.id) ?? []), { edge: i, side: "out" }]);
    atNode.set(b.id, [...(atNode.get(b.id) ?? []), { edge: i, side: "in" }]);
  });
  for (const ends of atNode.values()) {
    const angles = ends.map((e) => natural[e.edge]?.[e.side] ?? 0);
    const spread = spreadAngles(angles, PORT_GAP);
    ends.forEach((e, k) => {
      const angle = spread[k] ?? 0;
      const m = moved[e.edge];
      if (m && Math.abs(angle - (angles[k] ?? 0)) > 0.5) m[e.side] = angle;
    });
  }
  const edges: FigureEdge[] = links.map(({ a, b }, i) => {
    const route = routes[i] as EdgeRoute;
    const edge: FigureEdge = { from: a.id, to: b.id, ...route };
    const m = moved[i] ?? {};
    const n = natural[i] ?? { out: 0, in: 0 };
    if (m.out === undefined && m.in === undefined) return edge;
    const turned: EdgeRoute = {
      bend: 0,
      out: Math.round(m.out ?? n.out),
      in: Math.round(m.in ?? n.in),
    };
    const clear = closest(curveOf(a, b, turned), obstaclesFor(a, b)) >= CLEARANCE;
    return clear ? { from: a.id, to: b.id, ...turned } : edge;
  });

  // Shift everything so the drawing, bent edges included, starts at the margin.
  const xs: number[] = [];
  const ys: number[] = [];
  for (const n of nodes) xs.push(n.x - n.width / 2, n.x + n.width / 2);
  for (const n of nodes) ys.push(n.y - n.height / 2, n.y + n.height / 2);
  for (const p of plates) xs.push(p.x0, p.x1);
  for (const p of plates) ys.push(p.y0, p.y1);
  for (const e of edges) {
    if (e.bend === 0 && e.out === undefined) continue;
    const curve = routeCurve(
      nodeShape(byId.get(e.from) as FigureNode),
      nodeShape(byId.get(e.to) as FigureNode),
      e,
    );
    for (const p of samplePoints(curve)) {
      xs.push(p.x);
      ys.push(p.y);
    }
  }
  const dx = MARGIN - Math.min(...xs);
  const dy = MARGIN - Math.min(...ys);
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
  const width = Math.max(...xs) + dx + MARGIN;
  const height = Math.max(...ys) + dy + MARGIN;

  return { name, nodes, plates, edges, width, height, nodeSize };
}
