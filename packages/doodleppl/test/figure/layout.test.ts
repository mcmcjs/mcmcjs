import { describe, expect, it } from "vitest";
import { figureLayout } from "../../src/figure/layout";
import { hospitals, nested } from "./helpers";

const within = (outer: { x0: number; y0: number; x1: number; y1: number }, x: number, y: number) =>
  x >= outer.x0 && x <= outer.x1 && y >= outer.y0 && y <= outer.y1;

describe("figureLayout", () => {
  it("keeps the document's arrangement and scales it to the requested spacing", () => {
    const layout = figureLayout(hospitals(), { spacing: 2 });
    const at = (id: string) => layout.nodes.find((n) => n.id === id) as { x: number; y: number };
    // mu is left of tau and above b, as in the document.
    expect(at("mu").x).toBeLessThan(at("tau").x);
    expect(at("mu").y).toBeLessThan(at("b").y);
    // The median distance from a node to its nearest neighbour becomes the spacing.
    const nearest = layout.nodes
      .map((a) =>
        Math.min(
          ...layout.nodes.filter((b) => b !== a).map((b) => Math.hypot(a.x - b.x, a.y - b.y)),
        ),
      )
      .sort((a, b) => a - b);
    const mid = nearest.length / 2;
    expect(((nearest[mid - 1] as number) + (nearest[mid] as number)) / 2).toBeCloseTo(2, 5);
  });

  it("gives each node its kind", () => {
    const kinds = Object.fromEntries(figureLayout(hospitals()).nodes.map((n) => [n.id, n.kind]));
    expect(kinds).toEqual({
      mu: "stochastic",
      tau: "stochastic",
      b: "stochastic",
      p: "deterministic",
      n: "constant",
      r: "observed",
    });
  });

  it("draws a plate around its members and leaves the others outside", () => {
    const layout = figureLayout(hospitals());
    const plate = layout.plates[0] as (typeof layout.plates)[number];
    expect(plate.variable).toBe("i");
    expect(plate.range).toEqual(["1", "N"]);
    for (const node of layout.nodes) {
      const inside = within(plate, node.x, node.y);
      expect(inside, node.id).toBe(["b", "p", "n", "r"].includes(node.id));
    }
  });

  it("puts an inner plate inside the plate around it", () => {
    const layout = figureLayout(nested());
    const outer = layout.plates.find((p) => p.id === "plate_i") as (typeof layout.plates)[number];
    const inner = layout.plates.find((p) => p.id === "plate_j") as (typeof layout.plates)[number];
    expect(inner.x0).toBeGreaterThan(outer.x0);
    expect(inner.x1).toBeLessThan(outer.x1);
    expect(inner.y0).toBeGreaterThanOrEqual(outer.y0);
    expect(inner.y1).toBeLessThan(outer.y1);
  });

  it("starts the drawing at the origin and sizes the page to fit", () => {
    const layout = figureLayout(hospitals());
    const half = layout.nodeSize / 2;
    const left = Math.min(
      ...layout.nodes.map((n) => n.x - half),
      ...layout.plates.map((p) => p.x0),
    );
    const top = Math.min(...layout.nodes.map((n) => n.y - half), ...layout.plates.map((p) => p.y0));
    expect(left).toBeGreaterThan(0);
    expect(top).toBeGreaterThan(0);
    for (const n of layout.nodes) {
      expect(n.x + half).toBeLessThanOrEqual(layout.width);
      expect(n.y + half).toBeLessThanOrEqual(layout.height);
    }
  });

  it("keeps only edges between drawn nodes", () => {
    const layout = figureLayout(hospitals());
    expect(layout.edges).toHaveLength(5);
  });

  it("names the node that has no position", () => {
    const doc = hospitals();
    const tau = doc.elements?.find((el) => el.id === "tau") as { position?: unknown };
    delete tau.position;
    expect(() => figureLayout(doc)).toThrow(/node "tau" has no position/);
  });

  it("refuses a graph with nothing to draw", () => {
    expect(() => figureLayout([])).toThrow(/no nodes/);
  });
});
