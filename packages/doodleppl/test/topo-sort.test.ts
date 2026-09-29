import { describe, expect, it } from "vitest";
import { buildPlateAwareOrder, buildTopologicalOrder } from "../src/core/topo-sort";
import type { GraphEdge, GraphNode } from "../src/core/types";

const n = (id: string): GraphNode => ({ id, name: id, type: "node", nodeType: "stochastic" });
const e = (source: string, target: string): GraphEdge => ({
  id: `${source}_${target}`,
  type: "edge",
  source,
  target,
});

describe("buildTopologicalOrder", () => {
  it("orders parents before children", () => {
    const order = buildTopologicalOrder([n("a"), n("b"), n("c")], [e("a", "b"), e("b", "c")]);
    expect(order.indexOf("a")).toBeLessThan(order.indexOf("b"));
    expect(order.indexOf("b")).toBeLessThan(order.indexOf("c"));
  });

  it("drops nodes in a cycle (output shorter than input signals a cycle)", () => {
    const order = buildTopologicalOrder([n("a"), n("b")], [e("a", "b"), e("b", "a")]);
    expect(order).toHaveLength(0);
  });
});

describe("buildPlateAwareOrder", () => {
  const plate = (id: string, parent?: string): GraphNode => ({
    id,
    name: id,
    type: "node",
    nodeType: "plate",
    ...(parent ? { parent } : {}),
  });
  const inside = (id: string, parent: string): GraphNode => ({ ...n(id), parent });
  const before = (order: string[], a: string, b: string) => order.indexOf(a) < order.indexOf(b);

  it("puts a plate after the top-level node its members read", () => {
    // The plate is listed first and has no edges, which is what put it first before.
    const order = buildPlateAwareOrder([plate("p"), n("s"), inside("m", "p")], [e("s", "m")]);
    expect(before(order, "s", "p")).toBe(true);
  });

  it("puts a plate before the top-level node that reads its members", () => {
    const order = buildPlateAwareOrder([n("r"), plate("p"), inside("m", "p")], [e("m", "r")]);
    expect(before(order, "p", "r")).toBe(true);
  });

  it("orders a nested plate among its siblings by what its members read", () => {
    const nodes = [plate("p"), plate("q", "p"), inside("d", "p"), inside("m", "q")];
    const order = buildPlateAwareOrder(nodes, [e("d", "m")]);
    expect(before(order, "d", "q")).toBe(true);
  });

  it("comes back shorter when two siblings depend on each other", () => {
    const nodes = [plate("p"), n("s"), inside("a", "p"), inside("b", "p")];
    const order = buildPlateAwareOrder(nodes, [e("a", "s"), e("s", "b")]);
    expect(order.length).toBeLessThan(nodes.length);
  });

  it("counts only the edges between assigned nodes", () => {
    // `x` is data in the plate that `s` reads, and `c` in the same plate reads `s`.
    const nodes = [plate("p"), n("s"), inside("x", "p"), inside("c", "p")];
    const edges = [e("x", "s"), e("s", "c")];
    expect(buildPlateAwareOrder(nodes, edges).length).toBeLessThan(nodes.length);
    expect(before(buildPlateAwareOrder(nodes, edges, new Set(["s", "c"])), "s", "p")).toBe(true);
  });

  it("keeps the plain order where no counted edge decides", () => {
    const nodes = [n("t"), n("u"), n("v")];
    const edges = [e("t", "u")];
    const order = buildPlateAwareOrder(nodes, edges, new Set(["u", "v"]));
    expect(order).toEqual(buildTopologicalOrder(nodes, edges));
  });
});
