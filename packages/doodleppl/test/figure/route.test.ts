import { describe, expect, it } from "vitest";
import { circle, distanceTo } from "../../src/figure/geometry";
import {
  chooseBend,
  chooseRoute,
  edgeCurve,
  endDirections,
  outInCurve,
  routeCurve,
  samplePoints,
  spreadAngles,
} from "../../src/figure/route";

const a = circle(0, 0, 0.5);
const b = circle(4, 0, 0.5);

describe("edgeCurve", () => {
  it("runs straight between the outlines when not bent", () => {
    const curve = edgeCurve(a, b, 0);
    expect(curve.start.x).toBeCloseTo(0.5);
    expect(curve.start.y).toBeCloseTo(0);
    expect(curve.end.x).toBeCloseTo(3.5);
    expect(curve.end.y).toBeCloseTo(0);
  });

  it("bends left of travel on a page where y points down, as TikZ's bend left does", () => {
    // Travelling right, the left is up the page, which is negative y.
    const mid = samplePoints(edgeCurve(a, b, 30), 2)[1] as { y: number };
    expect(mid.y).toBeLessThan(0);
    const right = samplePoints(edgeCurve(a, b, -30), 2)[1] as { y: number };
    expect(right.y).toBeCloseTo(-mid.y);
  });

  it("leaves and enters at the bend angle, with TikZ's control distance", () => {
    const { start, c1, c2, end } = edgeCurve(a, b, 30);
    const t = Math.PI / 6;
    expect(start.x).toBeCloseTo(0.5 * Math.cos(t));
    expect(start.y).toBeCloseTo(-0.5 * Math.sin(t));
    const d = Math.hypot(end.x - start.x, end.y - start.y);
    expect(Math.hypot(c1.x - start.x, c1.y - start.y)).toBeCloseTo(0.3915 * d);
    expect(Math.hypot(c2.x - end.x, c2.y - end.y)).toBeCloseTo(0.3915 * d);
  });
});

describe("outInCurve", () => {
  it("leaves and arrives along the given page angles, from the outline points there", () => {
    const curve = outInCurve(a, b, -90, 180);
    expect(curve.start.x).toBeCloseTo(0);
    expect(curve.start.y).toBeCloseTo(-0.5);
    expect(curve.end.x).toBeCloseTo(3.5);
    expect(curve.end.y).toBeCloseTo(0);
    const ends = endDirections(curve);
    expect(ends.start.y).toBeCloseTo(-1);
    expect(ends.end.x).toBeCloseTo(-1);
  });
});

describe("chooseRoute", () => {
  it("turns the ends when no even bend gets past", () => {
    // A wall across the direct way leaves only a route that swings out and comes back in from the side.
    const wall = [circle(2, 0, 0.6), circle(2, -0.6, 0.6), circle(2, 0.6, 0.6)];
    const route = chooseRoute(a, b, wall, 0.05);
    expect(route.out).toBeDefined();
    const curve = routeCurve(a, b, route);
    for (const p of samplePoints(curve).slice(1, -1)) {
      for (const w of wall) expect(distanceTo(w, p)).toBeGreaterThanOrEqual(0.05);
    }
  });

  it("stays an even bend or straight when that is clear", () => {
    expect(chooseRoute(a, b, [circle(2, 3, 0.5)], 0.1)).toEqual({ bend: 0 });
    const bent = chooseRoute(a, b, [circle(2, -0.2, 0.5)], 0.1);
    expect(bent.out).toBeUndefined();
    expect(bent.bend).not.toBe(0);
  });
});

describe("spreadAngles", () => {
  it("opens up angles that are too close and keeps their order", () => {
    const spread = spreadAngles([-100, -95, -90, 0], 20);
    expect(spread[1]).toBeCloseTo(-95);
    expect((spread[1] as number) - (spread[0] as number)).toBeCloseTo(20);
    expect((spread[2] as number) - (spread[1] as number)).toBeCloseTo(20);
    expect(spread[3]).toBe(0);
  });

  it("opens up angles either side of the half turn", () => {
    const [p, q] = spreadAngles([178, -178], 20) as [number, number];
    expect(p).toBeCloseTo(170);
    expect(q).toBeCloseTo(-170);
  });

  it("shares the circle evenly when the angles cannot all be as far apart as asked", () => {
    const spread = spreadAngles([0, 1, 2, 3], 120);
    const sorted = [...spread].sort((x, y) => x - y);
    for (let k = 1; k < sorted.length; k++) {
      expect((sorted[k] as number) - (sorted[k - 1] as number)).toBeCloseTo(90);
    }
  });
});

describe("chooseBend", () => {
  const between = (bend: number) => edgeCurve(a, b, bend);

  it("keeps an edge straight when nothing is in its way", () => {
    expect(chooseBend(between, [circle(2, 2, 0.5)], 0.1)).toBe(0);
  });

  it("bends away from a node sitting just off the straight line, and clears it", () => {
    const blocker = circle(2, -0.2, 0.5);
    const bend = chooseBend(between, [blocker], 0.1);
    // The blocker is up the page, to the left of travel, so the edge bends right.
    expect(bend).toBeLessThan(0);
    for (const p of samplePoints(edgeCurve(a, b, bend)).slice(1, -1)) {
      expect(distanceTo(blocker, p)).toBeGreaterThanOrEqual(0.1);
    }
  });

  it("prefers a bend that meets the end node away from an arrow already there", () => {
    const blocker = circle(2, 0, 0.5);
    const free = chooseBend(between, [blocker], 0.1);
    // Put an arrow where the freely chosen bend would arrive, so the other side wins.
    const arrival = endDirections(edgeCurve(a, b, free)).end;
    const bend = chooseBend(between, [blocker], 0.1, { start: [], end: [arrival] });
    expect(Math.sign(bend)).toBe(-Math.sign(free));
  });
});
