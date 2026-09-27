// Edges as TikZ draws them: straight, bent with `bend left` / `bend right` when a
// straight line would run through a node or a plate label, or leaving and arriving
// at chosen angles with `to[out=..., in=...]` when no even bend is clear or when
// arrows would meet a node at the same place.

import { centre, distanceTo, type Point, reach, type Shape } from "./geometry";

export interface Curve {
  start: Point;
  c1: Point;
  c2: Point;
  end: Point;
}

export interface EdgeRoute {
  /** Degrees the edge bends left of travel (negative bends right), used when `out` and `in` are not set. */
  bend: number;
  /** Page angle in degrees the edge leaves its start node at. */
  out?: number;
  /** Page angle in degrees of the point where the edge meets its end node, arriving along it. */
  in?: number;
}

/** TikZ puts each control point this fraction of the border-to-border distance out. */
const LOOSENESS = 0.3915;
const SAMPLES = 24;
const MAX_BEND = 45;
/** How far `out` and `in` may turn from the straight line when no even bend is clear. */
const MAX_TURN = 90;
/** Two arrows meeting a node closer than this, in degrees, draw their heads over each other. */
const MIN_SPREAD = 30;

const along = (p: Point, u: Point, d: number): Point => ({ x: p.x + u.x * d, y: p.y + u.y * d });
const radians = (degrees: number) => (degrees * Math.PI) / 180;
const direction = (angle: number): Point => ({
  x: Math.cos(radians(angle)),
  y: Math.sin(radians(angle)),
});

/** Page angle in degrees of a direction, with y pointing down. */
export const angleOf = (u: Point) => (Math.atan2(u.y, u.x) * 180) / Math.PI;

function withControls(start: Point, end: Point, out: Point, back: Point): Curve {
  const d = LOOSENESS * Math.hypot(end.x - start.x, end.y - start.y);
  return { start, c1: along(start, out, d), c2: along(end, back, d), end };
}

/** The point on a shape's outline in the direction of a page angle, as a TikZ angle anchor. */
export function anchorPoint(shape: Shape, angle: number): Point {
  const u = direction(angle);
  return along(centre(shape), u, reach(shape, u.x, u.y));
}

/**
 * The edge from `from` to `to` bent `bend` degrees to the left of travel on the page
 * (negative bends right), with the same end points and control points as TikZ's
 * `to[bend left=bend]`. A bend of 0 is the straight line between the outlines.
 */
export function edgeCurve(from: Shape, to: Shape, bend: number): Curve {
  const a = centre(from);
  const b = centre(to);
  const chord = angleOf({ x: b.x - a.x, y: b.y - a.y });
  // With y pointing down, turning left of travel lowers the page angle.
  return outInCurve(from, to, chord - bend, chord + 180 + bend);
}

/** The edge leaving `from` at page angle `out` and meeting `to` at page angle `inAngle`, as TikZ's `to[out, in]`. */
export function outInCurve(from: Shape, to: Shape, out: number, inAngle: number): Curve {
  return withControls(
    anchorPoint(from, out),
    anchorPoint(to, inAngle),
    direction(out),
    direction(inAngle),
  );
}

/** The curve an edge takes between two outlines. */
export function routeCurve(from: Shape, to: Shape, route: EdgeRoute): Curve {
  return route.out === undefined || route.in === undefined
    ? edgeCurve(from, to, route.bend)
    : outInCurve(from, to, route.out, route.in);
}

export function pointOn(curve: Curve, t: number): Point {
  const u = 1 - t;
  const w0 = u * u * u;
  const w1 = 3 * u * u * t;
  const w2 = 3 * u * t * t;
  const w3 = t * t * t;
  return {
    x: w0 * curve.start.x + w1 * curve.c1.x + w2 * curve.c2.x + w3 * curve.end.x,
    y: w0 * curve.start.y + w1 * curve.c1.y + w2 * curve.c2.y + w3 * curve.end.y,
  };
}

/** Points along the curve, ends included. */
export function samplePoints(curve: Curve, count = SAMPLES): Point[] {
  return Array.from({ length: count + 1 }, (_, k) => pointOn(curve, k / count));
}

/** How close the curve comes to any obstacle's outline. */
export function closest(curve: Curve, obstacles: Shape[]): number {
  let worst = Number.POSITIVE_INFINITY;
  for (let k = 1; k < SAMPLES; k++) {
    const p = pointOn(curve, k / SAMPLES);
    for (const o of obstacles) worst = Math.min(worst, distanceTo(o, p));
  }
  return worst;
}

const unit = (p: Point): Point => {
  const len = Math.hypot(p.x, p.y) || 1;
  return { x: p.x / len, y: p.y / len };
};

/** The directions the edge leaves its start and its end, each pointing away from the node. */
export function endDirections(curve: Curve): { start: Point; end: Point } {
  return {
    start: unit({ x: curve.c1.x - curve.start.x, y: curve.c1.y - curve.start.y }),
    end: unit({ x: curve.c2.x - curve.end.x, y: curve.c2.y - curve.end.y }),
  };
}

/** Directions of the edges already drawn at an edge's two nodes, pointing away from each node. */
export interface Taken {
  start: Point[];
  end: Point[];
}

/** Smallest angle in degrees between this curve's ends and the edges already at its nodes. */
function spread(curve: Curve, taken: Taken): number {
  const ends = endDirections(curve);
  const angle = (u: Point, v: Point) =>
    (Math.acos(Math.max(-1, Math.min(1, u.x * v.x + u.y * v.y))) * 180) / Math.PI;
  return Math.min(
    180,
    ...taken.start.map((d) => angle(ends.start, d)),
    ...taken.end.map((d) => angle(ends.end, d)),
  );
}

/** Each degree an arrow falls short of the spread costs as much as two more degrees of turn. */
const crowding = (curve: Curve, taken: Taken) => 2 * Math.max(0, MIN_SPREAD - spread(curve, taken));

/**
 * The smallest bend that keeps an edge at least `clearance` from every obstacle,
 * trying first the side away from the obstacle nearest the straight line. A bent
 * edge also tries to meet its nodes at least 30 degrees from the edges in `taken`,
 * so arrow heads do not pile up. `curveFor` draws the edge at a given bend. When no
 * bend up to 45 degrees is clear, the one that comes least close is returned.
 */
export function chooseBend(
  curveFor: (bend: number) => Curve,
  obstacles: Shape[],
  clearance: number,
  taken: Taken = { start: [], end: [] },
): number {
  const line = curveFor(0);
  const straight = closest(line, obstacles);
  if (straight >= clearance) return 0;

  const a = line.start;
  const b = line.end;
  let nearest = obstacles[0] as Shape;
  let nearestGap = Number.POSITIVE_INFINITY;
  for (const o of obstacles) {
    const gap = closest(line, [o]);
    if (gap < nearestGap) {
      nearest = o;
      nearestGap = gap;
    }
  }
  // Positive when the obstacle lies to the left of travel, so the edge bends right.
  const o = centre(nearest);
  const leftOf = (o.x - a.x) * (b.y - a.y) - (o.y - a.y) * (b.x - a.x);
  const first = leftOf > 0 ? -1 : 1;

  let clear: number | undefined;
  let clearCost = Number.POSITIVE_INFINITY;
  let best = 0;
  let bestGap = straight;
  for (let angle = 10; angle <= MAX_BEND && angle < clearCost; angle += 5) {
    for (const side of [first, -first]) {
      const bend = side * angle;
      const curve = curveFor(bend);
      const gap = closest(curve, obstacles);
      if (gap >= clearance) {
        const cost = angle + crowding(curve, taken);
        if (cost < clearCost) {
          clear = bend;
          clearCost = cost;
        }
      } else if (gap > bestGap) {
        best = bend;
        bestGap = gap;
      }
    }
  }
  return clear ?? best;
}

/**
 * The route for an edge: straight when clear, else the smallest even bend that is
 * clear, else the smallest turn of its leaving and arriving angles that is clear.
 * With nothing clear, the even bend that comes least close.
 */
export function chooseRoute(
  from: Shape,
  to: Shape,
  obstacles: Shape[],
  clearance: number,
  taken: Taken = { start: [], end: [] },
): EdgeRoute {
  const bend = chooseBend((b) => edgeCurve(from, to, b), obstacles, clearance, taken);
  if (closest(edgeCurve(from, to, bend), obstacles) >= clearance) return { bend };

  const a = centre(from);
  const b = centre(to);
  const chord = Math.round(angleOf({ x: b.x - a.x, y: b.y - a.y }));
  let best: EdgeRoute | undefined;
  let bestCost = Number.POSITIVE_INFINITY;
  for (let turnOut = -MAX_TURN; turnOut <= MAX_TURN; turnOut += 15) {
    for (let turnIn = -MAX_TURN; turnIn <= MAX_TURN; turnIn += 15) {
      const out = chord + turnOut;
      const inAngle = chord + 180 + turnIn;
      const curve = outInCurve(from, to, out, inAngle);
      if (closest(curve, obstacles) < clearance) continue;
      const cost = Math.abs(turnOut) + Math.abs(turnIn) + crowding(curve, taken);
      if (cost < bestCost) {
        best = { bend: 0, out, in: inAngle };
        bestCost = cost;
      }
    }
  }
  return best ?? { bend };
}

/**
 * Move angles round a circle so neighbours are at least `gap` degrees apart,
 * keeping their order. All the pushes in a round add up before any angle moves.
 */
export function spreadAngles(angles: number[], gap: number): number[] {
  const n = angles.length;
  if (n < 2) return [...angles];
  const need = Math.min(gap, 360 / n);
  const order = angles
    .map((_, i) => i)
    .sort((i, j) => (angles[i] as number) - (angles[j] as number));
  const a = order.map((i) => angles[i] as number);
  for (let round = 0; round < 200; round++) {
    const shift = a.map(() => 0);
    let moved = false;
    for (let k = 0; k < n; k++) {
      const next = (k + 1) % n;
      const span = (a[next] as number) - (a[k] as number) + (next === 0 ? 360 : 0);
      if (span >= need - 1e-6) continue;
      const push = (need - span) / 2;
      shift[k] = (shift[k] as number) - push;
      shift[next] = (shift[next] as number) + push;
      moved = true;
    }
    if (!moved) break;
    for (let k = 0; k < n; k++) a[k] = (a[k] as number) + (shift[k] as number);
  }
  const out = new Array<number>(n);
  order.forEach((i, k) => {
    out[i] = a[k] as number;
  });
  return out;
}
