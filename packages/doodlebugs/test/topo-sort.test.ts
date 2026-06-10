import { describe, expect, it } from "vitest";
import { buildTopologicalOrder } from "../src/topo-sort";
import type { GraphEdge, GraphNode } from "../src/types";

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
