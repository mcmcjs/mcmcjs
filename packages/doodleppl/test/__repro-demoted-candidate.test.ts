import { appendFileSync, writeFileSync } from "node:fs";
import { describe, it } from "vitest";

const OUT =
  "/tmp/claude-1000/-home-seeker-Work-GSoC/2ee90ae1-369d-40a9-bba2-912ac29c0a21/scratchpad/repro-demoted.txt";
writeFileSync(OUT, "");

import { generateStanModel } from "../src/codegen/stan";
import { analyzeDiscreteLatents } from "../src/core/discrete-analysis";
import { buildTopologicalOrder } from "../src/core/topo-sort";
import type { GraphEdge, GraphElement, GraphNode } from "../src/core/types";
import { edge, node } from "./helpers/marginalization-fixtures";

function dump(label: string, els: GraphElement[]) {
  const nodes = els.filter((e): e is GraphNode => e.type === "node");
  const edges = els.filter((e): e is GraphEdge => e.type === "edge");
  const topo = buildTopologicalOrder(nodes, edges);
  const analysis = analyzeDiscreteLatents(els, topo);
  appendFileSync(
    OUT,
    `\n########## ${label} ##########\n` +
      `LATENTS: ${JSON.stringify(
        analysis.latents.map((l) => ({ name: l.node.name, tier: l.tier, reason: l.reason })),
      )}\n` +
      `PLATE PLANS: ${JSON.stringify(
        analysis.platePlans.map((p) => ({
          latent: p.latent.name,
          factors: p.factors.map((f) => f.name),
        })),
      )}\n` +
      `SCALAR PLAN: ${JSON.stringify(
        analysis.scalarPlan
          ? analysis.scalarPlan.steps.map((s) => ({
              latent: s.latent.name,
              bucketFactors: s.bucketFactors.map((f) => f.name),
            }))
          : null,
      )}\n` +
      `CONSUMED: ${JSON.stringify([...analysis.consumedFactorIds])}\n` +
      `=== GENERATED STAN ===\n${generateStanModel(els)}\n`,
  );
}

describe("repro: demoted discrete candidate as factor of surviving latent", () => {
  it("plate flavor: z2[i] ~ dbern(p[z1[i]]) demoted, z1 survives", () => {
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
      node({ id: "d", name: "d", nodeType: "constant" }),
      node({ id: "mu0", name: "mu0", nodeType: "constant" }),
      node({
        id: "z1",
        name: "z1",
        distribution: "dcat",
        param1: "w[1:2]",
        indices: "i",
        parent: "plate_i",
      }),
      node({
        id: "z2",
        name: "z2",
        distribution: "dbern",
        param1: "p[z1[i]]",
        indices: "i",
        parent: "plate_i",
      }),
      node({
        id: "y",
        name: "y",
        nodeType: "observed",
        distribution: "dnorm",
        param1: "mu0 + d[z2[i] + 1]",
        param2: "1",
        indices: "i",
        parent: "plate_i",
      }),
      edge("w", "z1"),
      edge("z1", "z2"),
      edge("p", "z2"),
      edge("z2", "y"),
      edge("d", "y"),
      edge("mu0", "y"),
    ];
    dump("PLATE FLAVOR", els);
  });

  it("scalar flavor: z2 ~ dcat(q[z1]) unresolvable support, z1 survives", () => {
    const els = [
      node({ id: "w", name: "w", nodeType: "constant" }),
      node({ id: "q", name: "q", nodeType: "constant" }),
      node({ id: "d", name: "d", nodeType: "constant" }),
      node({ id: "z1", name: "z1", distribution: "dcat", param1: "w[1:2]" }),
      node({ id: "z2", name: "z2", distribution: "dcat", param1: "q[z1]" }),
      node({
        id: "y",
        name: "y",
        nodeType: "observed",
        distribution: "dnorm",
        param1: "d[z2]",
        param2: "1",
      }),
      edge("w", "z1"),
      edge("z1", "z2"),
      edge("q", "z2"),
      edge("z2", "y"),
      edge("d", "y"),
    ];
    dump("SCALAR FLAVOR", els);
  });
});
