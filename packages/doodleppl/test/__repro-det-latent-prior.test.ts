import { appendFileSync, writeFileSync } from "node:fs";
import { describe, it } from "vitest";

const OUT =
  "/tmp/claude-1000/-home-seeker-Work-GSoC/2ee90ae1-369d-40a9-bba2-912ac29c0a21/scratchpad/repro-det-latent-prior.txt";
writeFileSync(OUT, "");

import { generateStanModel } from "../src/codegen/stan";
import { analyzeDiscreteLatents } from "../src/core/discrete-analysis";
import { buildTopologicalOrder } from "../src/core/topo-sort";
import type { GraphEdge, GraphNode } from "../src/core/types";
import { edge, node } from "./helpers/marginalization-fixtures";

describe("repro: det between two scalar latents (feeds z2's prior)", () => {
  const els = [
    node({ id: "pi", name: "pi", nodeType: "constant" }),
    node({ id: "shift", name: "shift", nodeType: "constant" }),
    node({ id: "d", name: "d", nodeType: "constant" }),
    node({ id: "z1", name: "z1", distribution: "dcat", param1: "pi[1:2]" }),
    node({ id: "q", name: "q", nodeType: "deterministic", equation: "ilogit(shift[z1])" }),
    node({ id: "z2", name: "z2", distribution: "dbern", param1: "q" }),
    node({
      id: "y",
      name: "y",
      nodeType: "observed",
      distribution: "dnorm",
      param1: "d[z2+1]",
      param2: "1",
    }),
    edge("pi", "z1"),
    edge("z1", "q"),
    edge("shift", "q"),
    edge("q", "z2"),
    edge("z2", "y"),
    edge("d", "y"),
  ];

  it("analysis plan", () => {
    const nodes = els.filter((e): e is GraphNode => e.type === "node");
    const edges = els.filter((e): e is GraphEdge => e.type === "edge");
    const topo = buildTopologicalOrder(nodes, edges);
    const analysis = analyzeDiscreteLatents(els, topo);
    appendFileSync(
      OUT,
      `LATENTS: ${JSON.stringify(
        analysis.latents.map((l) => ({ name: l.node.name, tier: l.tier, reason: l.reason })),
      )}\n` +
        `SCALAR PLAN steps: ${JSON.stringify(
          analysis.scalarPlan
            ? analysis.scalarPlan.steps.map((s) => ({
                latent: s.latent.name,
                bucketFactors: s.bucketFactors.map((f) => f.name),
                bucketPhis: s.bucketPhis.map((f) => f.name),
                scopeAfter: s.scopeAfter.map((f) => f.name),
              }))
            : null,
        )}\n` +
        `SCALAR PLAN factors: ${JSON.stringify(
          analysis.scalarPlan?.factors.map((f) => f.name) ?? null,
        )}\n` +
        `SCALAR PLAN inlineDets: ${JSON.stringify(
          analysis.scalarPlan?.inlineDets.map((f) => f.name) ?? null,
        )}\n` +
        `inlinedDetIds: ${JSON.stringify([...analysis.inlinedDetIds])}\n` +
        `consumedFactorIds: ${JSON.stringify([...analysis.consumedFactorIds])}\n`,
    );
  });

  it("generated stan", () => {
    appendFileSync(OUT, `\n=== GENERATED STAN ===\n${generateStanModel(els)}\n`);
  });
});
