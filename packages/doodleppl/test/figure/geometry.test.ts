import { describe, expect, it } from "vitest";
import { circle, distanceTo, pushApart, reach, rect } from "../../src/figure/geometry";

describe("pushApart", () => {
  it("moves a circle along the line between centres, just far enough", () => {
    const push = pushApart(circle(0, 0, 1), circle(1, 0, 1), 0.5);
    expect(push?.x).toBeCloseTo(1.5);
    expect(push?.y).toBeCloseTo(0);
    expect(pushApart(circle(0, 0, 1), circle(2.5, 0, 1), 0.5)).toBeNull();
  });

  it("moves a box along the axis that needs the shorter move", () => {
    const push = pushApart(rect(0, 0, 4, 4), rect(3, 1, 6, 2), 0);
    expect(push).toEqual({ x: 1, y: 0 });
  });

  it("takes a circle whose centre is inside a box out through the nearest side", () => {
    const push = pushApart(rect(0, 0, 10, 4), circle(5, 3.5, 0.5), 0.2);
    expect(push?.x).toBeCloseTo(0);
    expect(push?.y).toBeCloseTo(1.2);
  });

  it("pushes the same distance whichever shape comes first", () => {
    const a = pushApart(rect(0, 0, 2, 2), circle(2.2, 1, 0.5), 0.1);
    const b = pushApart(circle(2.2, 1, 0.5), rect(0, 0, 2, 2), 0.1);
    expect(a?.x).toBeCloseTo(-(b?.x as number));
  });
});

describe("distanceTo and reach", () => {
  it("measures to the outline, negative inside", () => {
    expect(distanceTo(circle(0, 0, 1), { x: 3, y: 0 })).toBeCloseTo(2);
    expect(distanceTo(rect(0, 0, 2, 2), { x: 1, y: 1.5 })).toBeCloseTo(-0.5);
    expect(distanceTo(rect(0, 0, 2, 2), { x: 5, y: 6 })).toBeCloseTo(5);
  });

  it("finds a box's outline along a diagonal", () => {
    const d = Math.SQRT1_2;
    expect(reach(rect(-1, -1, 1, 1), d, d)).toBeCloseTo(Math.SQRT2);
    expect(reach(rect(-2, -1, 2, 1), 1, 0)).toBeCloseTo(2);
  });
});
