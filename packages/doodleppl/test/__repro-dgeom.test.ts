import { appendFileSync, writeFileSync } from "node:fs";
import { describe, it } from "vitest";

const OUT =
  "/tmp/claude-1000/-home-seeker-Work-GSoC/2ee90ae1-369d-40a9-bba2-912ac29c0a21/scratchpad/repro-dgeom.txt";
writeFileSync(OUT, "");

import { generateStanModel } from "../src/codegen/stan";
import { analyzeDiscreteLatents } from "../src/core/discrete-analysis";
import { buildTopologicalOrder } from "../src/core/topo-sort";
import type { GraphEdge, GraphNode } from "../src/core/types";
import { edge, node } from "./helpers/marginalization-fixtures";

describe("repro: dgeom factor in plate marginalization", () => {
  const els = [
    node({
      id: "plate_i",
      name: "i plate",
      nodeType: "plate",
      loopVariable: "i",
      loopRange: "1:N",
    }),
    node({ id: "w", name: "w", nodeType: "constant" }),
    node({ id: "p", name: "p", nodeType: "constant" }),
    node({
      id: "z",
      name: "z",
      distribution: "dcat",
      param1: "w[1:2]",
      indices: "i",
      parent: "plate_i",
    }),
    node({
      id: "y",
      name: "y",
      nodeType: "observed",
      distribution: "dgeom",
      param1: "p[z[i]]",
      indices: "i",
      parent: "plate_i",
    }),
    edge("w", "z"),
    edge("z", "y"),
    edge("p", "y"),
  ];

  it("plate tier: analysis + generated stan", () => {
    const nodes = els.filter((e): e is GraphNode => e.type === "node");
    const edges = els.filter((e): e is GraphEdge => e.type === "edge");
    const topo = buildTopologicalOrder(nodes, edges);
    const analysis = analyzeDiscreteLatents(els, topo);
    appendFileSync(
      OUT,
      `PLATE LATENTS: ${JSON.stringify(
        analysis.latents.map((l) => ({ name: l.node.name, tier: l.tier, reason: l.reason })),
      )}\nPLATE PLANS: ${JSON.stringify(
        analysis.platePlans.map((p) => ({
          latent: p.latent.name,
          factors: p.factors.map((f) => `${f.name}~${f.distribution}`),
        })),
      )}\nCONSUMED: ${JSON.stringify([...analysis.consumedFactorIds])}\n`,
    );
    appendFileSync(OUT, `\n=== PLATE GENERATED STAN ===\n${generateStanModel(els)}\n`);
  });

  it("scalar tier: z ~ dcat, y ~ dgeom observed, no plate", () => {
    const els2 = [
      node({ id: "w", name: "w", nodeType: "constant" }),
      node({ id: "p", name: "p", nodeType: "constant" }),
      node({ id: "z", name: "z", distribution: "dcat", param1: "w[1:2]" }),
      node({
        id: "y",
        name: "y",
        nodeType: "observed",
        distribution: "dgeom",
        param1: "p[z]",
      }),
      edge("w", "z"),
      edge("z", "y"),
      edge("p", "y"),
    ];
    const nodes = els2.filter((e): e is GraphNode => e.type === "node");
    const edges = els2.filter((e): e is GraphEdge => e.type === "edge");
    const analysis = analyzeDiscreteLatents(els2, buildTopologicalOrder(nodes, edges));
    appendFileSync(
      OUT,
      `\n=== SCALAR TIER ===\nLATENTS: ${JSON.stringify(
        analysis.latents.map((l) => ({ name: l.node.name, tier: l.tier, reason: l.reason })),
      )}\n${generateStanModel(els2)}\n`,
    );
  });

  it("mixed pair: y1 ~ dnorm kept, y2 ~ dgeom dropped", () => {
    const els3 = [
      node({
        id: "plate_i",
        name: "i plate",
        nodeType: "plate",
        loopVariable: "i",
        loopRange: "1:N",
      }),
      node({ id: "w", name: "w", nodeType: "constant" }),
      node({ id: "p", name: "p", nodeType: "constant" }),
      node({ id: "mu", name: "mu", nodeType: "constant" }),
      node({
        id: "z",
        name: "z",
        distribution: "dcat",
        param1: "w[1:2]",
        indices: "i",
        parent: "plate_i",
      }),
      node({
        id: "y1",
        name: "y1",
        nodeType: "observed",
        distribution: "dnorm",
        param1: "mu[z[i]]",
        param2: "1",
        indices: "i",
        parent: "plate_i",
      }),
      node({
        id: "y2",
        name: "y2",
        nodeType: "observed",
        distribution: "dgeom",
        param1: "p[z[i]]",
        indices: "i",
        parent: "plate_i",
      }),
      edge("w", "z"),
      edge("z", "y1"),
      edge("z", "y2"),
      edge("mu", "y1"),
      edge("p", "y2"),
    ];
    appendFileSync(OUT, `\n=== MIXED PAIR ===\n${generateStanModel(els3)}\n`);
  });
});
