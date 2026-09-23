import { describe, expect, it } from "vitest";
import { circle, pushApart } from "../../src/figure/geometry";
import { type Body, separate } from "../../src/figure/separate";

const disc = (x: number, y: number) => {
  const p = { x, y };
  const body: Body = {
    shape: () => circle(p.x, p.y, 0.5),
    move: (dx, dy) => {
      p.x += dx;
      p.y += dy;
    },
  };
  return { p, body };
};

describe("separate", () => {
  it("spreads a crowd until every pair keeps the gap", () => {
    const discs = [disc(0, 0), disc(0.2, 0.1), disc(0.4, 0), disc(0.1, 0.3), disc(0.3, 0.2)];
    separate(
      discs.map((d) => d.body),
      0.3,
    );
    for (let i = 0; i < discs.length; i++) {
      for (let j = i + 1; j < discs.length; j++) {
        const a = discs[i]?.body.shape();
        const b = discs[j]?.body.shape();
        if (!a || !b) throw new Error("missing disc");
        expect(pushApart(a, b, 0.3 - 1e-6)).toBeNull();
      }
    }
  });

  it("keeps a crowded row in its order", () => {
    const discs = [disc(0, 0), disc(0.3, 0), disc(0.35, 0), disc(0.9, 0), disc(1, 0)];
    separate(
      discs.map((d) => d.body),
      0.3,
    );
    const xs = discs.map((d) => d.p.x);
    expect([...xs].sort((a, b) => a - b)).toEqual(xs);
    expect(discs.every((d) => d.p.y === 0)).toBe(true);
  });

  it("leaves bodies that are already apart where they are", () => {
    const discs = [disc(0, 0), disc(3, 0)];
    separate(
      discs.map((d) => d.body),
      0.3,
    );
    expect(discs.map((d) => d.p)).toEqual([
      { x: 0, y: 0 },
      { x: 3, y: 0 },
    ]);
  });
});
