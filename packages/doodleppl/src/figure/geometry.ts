// Shapes on the page, in centimetres with y pointing down, and the distances the
// layout uses to keep nodes, plates and edges clear of each other.

export interface Point {
  x: number;
  y: number;
}

export type Shape =
  | { kind: "circle"; x: number; y: number; r: number }
  | { kind: "rect"; x0: number; y0: number; x1: number; y1: number };

export const circle = (x: number, y: number, r: number): Shape => ({ kind: "circle", x, y, r });

export const rect = (x0: number, y0: number, x1: number, y1: number): Shape => ({
  kind: "rect",
  x0,
  y0,
  x1,
  y1,
});

const EPS = 1e-9;

export function centre(shape: Shape): Point {
  return shape.kind === "circle"
    ? { x: shape.x, y: shape.y }
    : { x: (shape.x0 + shape.x1) / 2, y: (shape.y0 + shape.y1) / 2 };
}

/** The move of `b` that leaves it at least `gap` away from `a`, or null when it already is. */
export function pushApart(a: Shape, b: Shape, gap: number): Point | null {
  if (a.kind === "circle" && b.kind === "circle") {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const d = Math.hypot(dx, dy);
    const need = a.r + b.r + gap;
    if (d >= need - EPS) return null;
    if (d < EPS) return { x: need, y: 0 };
    return { x: (dx / d) * (need - d), y: (dy / d) * (need - d) };
  }
  if (a.kind === "rect" && b.kind === "rect") {
    const ox = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) + gap;
    const oy = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0) + gap;
    if (ox <= EPS || oy <= EPS) return null;
    // Leave along the axis that needs the shorter move, away from the other's centre.
    const dx = b.x0 + b.x1 - (a.x0 + a.x1);
    const dy = b.y0 + b.y1 - (a.y0 + a.y1);
    return ox <= oy ? { x: dx < 0 ? -ox : ox, y: 0 } : { x: 0, y: dy < 0 ? -oy : oy };
  }
  if (a.kind === "circle") {
    const push = pushApart(b, a, gap);
    return push && { x: -push.x, y: -push.y };
  }
  if (b.kind !== "circle") return null;
  const qx = Math.min(Math.max(b.x, a.x0), a.x1);
  const qy = Math.min(Math.max(b.y, a.y0), a.y1);
  const dx = b.x - qx;
  const dy = b.y - qy;
  const d = Math.hypot(dx, dy);
  const need = b.r + gap;
  if (d >= EPS) {
    if (d >= need - EPS) return null;
    return { x: (dx / d) * (need - d), y: (dy / d) * (need - d) };
  }
  // The circle's centre is inside the box, so it leaves by the nearest side.
  const sides: Point[] = [
    { x: a.x0 - b.x - need, y: 0 },
    { x: a.x1 - b.x + need, y: 0 },
    { x: 0, y: a.y0 - b.y - need },
    { x: 0, y: a.y1 - b.y + need },
  ];
  return sides.reduce((best, s) =>
    Math.abs(s.x) + Math.abs(s.y) < Math.abs(best.x) + Math.abs(best.y) ? s : best,
  );
}

/** Distance from a point to a shape's outline, negative inside the shape. */
export function distanceTo(shape: Shape, p: Point): number {
  if (shape.kind === "circle") return Math.hypot(p.x - shape.x, p.y - shape.y) - shape.r;
  const dx = Math.max(shape.x0 - p.x, 0, p.x - shape.x1);
  const dy = Math.max(shape.y0 - p.y, 0, p.y - shape.y1);
  if (dx > 0 || dy > 0) return Math.hypot(dx, dy);
  return -Math.min(p.x - shape.x0, shape.x1 - p.x, p.y - shape.y0, shape.y1 - p.y);
}

/** Distance from a shape's centre to its outline along a unit direction. */
export function reach(shape: Shape, ux: number, uy: number): number {
  if (shape.kind === "circle") return shape.r;
  const hw = (shape.x1 - shape.x0) / 2;
  const hh = (shape.y1 - shape.y0) / 2;
  return Math.min(
    Math.abs(ux) > EPS ? hw / Math.abs(ux) : Number.POSITIVE_INFINITY,
    Math.abs(uy) > EPS ? hh / Math.abs(uy) : Number.POSITIVE_INFINITY,
  );
}
