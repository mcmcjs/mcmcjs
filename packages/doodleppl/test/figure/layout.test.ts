import { describe, expect, it } from "vitest";
import { distanceTo, pushApart, rect, type Shape } from "../../src/figure/geometry";
import {
  type FigureNode,
  type FigurePlate,
  figureLayout,
  nodeShape,
} from "../../src/figure/layout";
import { edgeCurve, routeCurve, samplePoints } from "../../src/figure/route";
import { at, edge, hospitals, nested, plate } from "./helpers";

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

  it("moves apart nodes drawn on top of each other, keeping their order", () => {
    const layout = figureLayout([
      at("a", { x: 0, y: 0 }),
      at("b", { x: 10, y: 0 }),
      at("c", { x: 20, y: 0 }),
      at("d", { x: 0, y: 200 }),
    ]);
    const shapes = layout.nodes.map((n) => nodeShape(n));
    for (let i = 0; i < shapes.length; i++) {
      for (let j = i + 1; j < shapes.length; j++) {
        expect(pushApart(shapes[i] as Shape, shapes[j] as Shape, 0.4 - 1e-6)).toBeNull();
      }
    }
    const x = (id: string) => layout.nodes.find((n) => n.id === id)?.x as number;
    expect(x("a")).toBeLessThan(x("b"));
    expect(x("b")).toBeLessThan(x("c"));
  });

  it("keeps a node out of a plate it does not belong to, even when drawn inside it", () => {
    const layout = figureLayout([
      plate("p", "i", "1:N"),
      at("m1", { x: 0, y: 100 }, { parent: "p" }),
      at("m2", { x: 200, y: 100 }, { parent: "p" }),
      at("stray", { x: 100, y: 100 }),
    ]);
    const box = layout.plates[0] as FigurePlate;
    const stray = layout.nodes.find((n) => n.id === "stray") as FigureNode;
    expect(pushApart(rect(box.x0, box.y0, box.x1, box.y1), nodeShape(stray), 0)).toBeNull();
  });

  it("keeps plates side by side when their members were drawn overlapping", () => {
    const layout = figureLayout([
      plate("p", "i", "1:N"),
      plate("q", "j", "1:M"),
      at("a", { x: 0, y: 0 }, { parent: "p" }),
      at("b", { x: 100, y: 0 }, { parent: "p" }),
      at("c", { x: 60, y: 30 }, { parent: "q" }),
      at("d", { x: 160, y: 30 }, { parent: "q" }),
    ]);
    const [p, q] = layout.plates as [FigurePlate, FigurePlate];
    expect(pushApart(rect(p.x0, p.y0, p.x1, p.y1), rect(q.x0, q.y0, q.x1, q.y1), 0)).toBeNull();
  });

  it("widens a plate that is narrower than its loop label", () => {
    const layout = figureLayout([
      plate("p", "subject", "1:participants"),
      at("a", { x: 0, y: 0 }, { parent: "p" }),
      at("b", { x: 0, y: 100 }),
    ]);
    const box = layout.plates[0] as FigurePlate;
    const a = layout.nodes.find((n) => n.id === "a") as FigureNode;
    expect(box.x1 - box.x0).toBeGreaterThan(3);
    // The member stays in the middle of the wider plate.
    expect((box.x0 + box.x1) / 2).toBeCloseTo(a.x);
  });

  it("grows a node to fit a long name", () => {
    const layout = figureLayout([at("population", { x: 0, y: 0 }), at("a", { x: 100, y: 0 })]);
    const [long, short] = layout.nodes as [FigureNode, FigureNode];
    expect(short.width).toBe(layout.nodeSize);
    expect(long.width).toBeGreaterThan(layout.nodeSize);
  });

  it("bends an edge around a node in its way and leaves the others straight", () => {
    const layout = figureLayout([
      at("a", { x: 0, y: 0 }),
      at("b", { x: 100, y: 0 }),
      at("c", { x: 200, y: 0 }),
      edge("a", "b"),
      edge("a", "c"),
    ]);
    const bend = (to: string) => layout.edges.find((e) => e.to === to)?.bend;
    expect(bend("b")).toBe(0);
    expect(bend("c")).not.toBe(0);
    const node = (id: string) => nodeShape(layout.nodes.find((n) => n.id === id) as FigureNode);
    const curve = edgeCurve(node("a"), node("c"), bend("c") as number);
    for (const p of samplePoints(curve).slice(1, -1)) {
      expect(distanceTo(node("b"), p)).toBeGreaterThan(0);
    }
    // The page grows to hold the bulge.
    for (const p of samplePoints(curve)) {
      expect(p.y).toBeGreaterThan(0);
      expect(p.y).toBeLessThan(layout.height);
    }
  });

  it("moves arrow ends round a node so no two meet it closer than 20 degrees", () => {
    const layout = figureLayout([
      at("p1", { x: 0, y: 0 }),
      at("p2", { x: 40, y: 0 }),
      at("p3", { x: 80, y: 0 }),
      at("t", { x: 40, y: 600 }),
      edge("p1", "t"),
      edge("p2", "t"),
      edge("p3", "t"),
    ]);
    const node = (id: string) => layout.nodes.find((n) => n.id === id) as FigureNode;
    const t = node("t");
    const arrivals = layout.edges
      .map((e) => routeCurve(nodeShape(node(e.from)), nodeShape(t), e).end)
      .map((p) => (Math.atan2(p.y - t.y, p.x - t.x) * 180) / Math.PI)
      .sort((x, y) => x - y);
    expect((arrivals[1] as number) - (arrivals[0] as number)).toBeGreaterThanOrEqual(19.5);
    expect((arrivals[2] as number) - (arrivals[1] as number)).toBeGreaterThanOrEqual(19.5);
    // The middle arrow, already in the middle, keeps its ends.
    expect(layout.edges.find((e) => e.from === "p2")?.in).toBeUndefined();
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
