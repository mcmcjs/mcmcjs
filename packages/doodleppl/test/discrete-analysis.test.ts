import { describe, expect, it } from "vitest";
import { analyzeDiscreteLatents, marginalizedLatentNames } from "../src/core/discrete-analysis";
import { buildTopologicalOrder } from "../src/core/topo-sort";
import type { GraphEdge, GraphElement, GraphNode } from "../src/core/types";

const node = (n: Partial<GraphNode> & { id: string; name: string }): GraphElement =>
  ({ type: "node", nodeType: "stochastic", ...n }) as GraphNode;

const edge = (source: string, target: string): GraphElement =>
  ({ id: `${source}->${target}`, type: "edge", source, target }) as GraphEdge;

function analyze(elements: GraphElement[]) {
  const nodes = elements.filter((el): el is GraphNode => el.type === "node");
  const edges = elements.filter((el): el is GraphEdge => el.type === "edge");
  return analyzeDiscreteLatents(elements, buildTopologicalOrder(nodes, edges));
}

/** Two-component mixture: z[i] ~ dcat(w[1:2]); y[i] ~ dnorm(mu[z[i]], tau) in plate i. */
function mixtureElements(): GraphElement[] {
  return [
    node({
      id: "plate_i",
      name: "i plate",
      nodeType: "plate",
      loopVariable: "i",
      loopRange: "1:N",
    }),
    node({
      id: "plate_k",
      name: "k plate",
      nodeType: "plate",
      loopVariable: "k",
      loopRange: "1:2",
    }),
    node({ id: "w", name: "w", nodeType: "constant" }),
    node({ id: "tau", name: "tau", distribution: "dgamma", param1: "1", param2: "1" }),
    node({
      id: "mu",
      name: "mu",
      distribution: "dnorm",
      param1: "0",
      param2: "0.01",
      indices: "k",
      parent: "plate_k",
    }),
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
      distribution: "dnorm",
      param1: "mu[z[i]]",
      param2: "tau",
      indices: "i",
      parent: "plate_i",
    }),
    edge("w", "z"),
    edge("z", "y"),
    edge("mu", "y"),
    edge("tau", "y"),
  ];
}

/**
 * The mixed DAG from the auto-marginalization paper, with a dbern gate:
 * X -> A -> B -> D, A -> pC -> C -> D, Z -> D; A, B continuous, D observed.
 */
function mixedDagElements(): GraphElement[] {
  return [
    node({ id: "X", name: "X", distribution: "dcat", param1: "piX[1:2]" }),
    node({ id: "Z", name: "Z", distribution: "dcat", param1: "piZ[1:2]" }),
    node({ id: "A", name: "A", distribution: "dnorm", param1: "muX[X]", param2: "tauA" }),
    node({ id: "B", name: "B", distribution: "dnorm", param1: "A", param2: "tauB" }),
    node({
      id: "pC",
      name: "pC",
      nodeType: "deterministic",
      equation: "ilogit(alpha0 + alpha1 * A)",
    }),
    node({ id: "C", name: "C", distribution: "dbern", param1: "pC" }),
    node({
      id: "D",
      name: "D",
      nodeType: "observed",
      distribution: "dnorm",
      param1: "B + deltaC[C + 1] + deltaZ[Z]",
      param2: "tauD",
    }),
    edge("X", "A"),
    edge("A", "B"),
    edge("A", "pC"),
    edge("pC", "C"),
    edge("B", "D"),
    edge("C", "D"),
    edge("Z", "D"),
  ];
}

describe("analyzeDiscreteLatents: iid plate tier", () => {
  it("classifies a mixture latent and resolves dcat support from an explicit range", () => {
    const analysis = analyze(mixtureElements());
    const z = analysis.latents.find((l) => l.node.id === "z");
    expect(z?.tier).toBe("iid-plate");
    expect(z?.support).toEqual({ size: "2", lo: 1 });
    expect(analysis.platePlans).toHaveLength(1);
    expect(analysis.platePlans[0]?.factors.map((f) => f.id)).toEqual(["y"]);
    expect([...analysis.consumedFactorIds].sort()).toEqual(["y", "z"]);
    expect(analysis.scalarPlan).toBeNull();
  });

  it("resolves dbern support with zero-based values", () => {
    const elements = mixtureElements().map((el) =>
      el.type === "node" && el.id === "z"
        ? ({ ...el, distribution: "dbern", param1: "0.3" } as GraphNode)
        : el,
    );
    const analysis = analyze(elements);
    expect(analysis.latents[0]?.support).toEqual({ size: "2", lo: 0 });
  });

  it("resolves dcat support from a referenced dirichlet simplex", () => {
    const elements: GraphElement[] = [
      node({ id: "plate_i", name: "ip", nodeType: "plate", loopVariable: "i", loopRange: "1:N" }),
      node({ id: "w", name: "w", distribution: "ddirich", param1: "alpha[1:3]" }),
      node({
        id: "z",
        name: "z",
        distribution: "dcat",
        param1: "w",
        indices: "i",
        parent: "plate_i",
      }),
      node({
        id: "y",
        name: "y",
        nodeType: "observed",
        distribution: "dnorm",
        param1: "mu[z[i]]",
        param2: "1",
        indices: "i",
        parent: "plate_i",
      }),
      edge("w", "z"),
      edge("z", "y"),
    ];
    const analysis = analyze(elements);
    expect(analysis.latents[0]?.support).toEqual({ size: "3", lo: 1 });
    expect(analysis.latents[0]?.tier).toBe("iid-plate");
  });
});

describe("analyzeDiscreteLatents: scalar DAG tier", () => {
  it("plans variable elimination with the frontier of the paper's mixed DAG", () => {
    const analysis = analyze(mixedDagElements());
    const tiers = Object.fromEntries(analysis.latents.map((l) => [l.node.id, l.tier]));
    expect(tiers).toEqual({ X: "scalar-dag", Z: "scalar-dag", C: "scalar-dag" });

    const plan = analysis.scalarPlan;
    expect(plan).not.toBeNull();
    // D's scope {Z, C} is placed first, X follows: sampling order Z, C, X.
    expect(plan?.latents.map((n) => n.id)).toEqual(["Z", "C", "X"]);
    // Elimination is the reverse; the frontier after eliminating C is {Z}.
    expect(plan?.steps.map((s) => s.latent.id)).toEqual(["X", "C", "Z"]);
    // Each bucket lists the latent's own prior node first, then consumed factors.
    const stepX = plan?.steps[0];
    expect(stepX?.bucketFactors.map((f) => f.id)).toEqual(["X", "A"]);
    expect(stepX?.scopeAfter).toEqual([]);
    const stepC = plan?.steps[1];
    expect(stepC?.bucketFactors.map((f) => f.id)).toEqual(["C", "D"]);
    expect(stepC?.scopeAfter.map((n) => n.id)).toEqual(["Z"]);
    const stepZ = plan?.steps[2];
    expect(stepZ?.bucketFactors.map((f) => f.id)).toEqual(["Z"]);
    expect(stepZ?.bucketPhis.map((n) => n.id)).toEqual(["C"]);
    expect(stepZ?.scopeAfter).toEqual([]);

    expect(plan?.factors.map((f) => f.id).sort()).toEqual(["A", "D"]);
    expect([...analysis.consumedFactorIds].sort()).toEqual(["A", "C", "D", "X", "Z"]);
    // pC depends only on continuous A, so it stays a transformed parameter.
    expect(analysis.inlinedDetIds.size).toBe(0);
  });

  it("inlines deterministic nodes that carry a discrete latent into a factor", () => {
    const elements: GraphElement[] = [
      node({ id: "Z", name: "Z", distribution: "dcat", param1: "pi[1:2]" }),
      node({ id: "m", name: "m", nodeType: "deterministic", equation: "shift[Z]" }),
      node({
        id: "y",
        name: "y",
        nodeType: "observed",
        distribution: "dnorm",
        param1: "m",
        param2: "1",
      }),
      edge("Z", "m"),
      edge("m", "y"),
    ];
    const analysis = analyze(elements);
    expect(analysis.latents[0]?.tier).toBe("scalar-dag");
    expect(analysis.scalarPlan?.inlineDets.map((d) => d.id)).toEqual(["m"]);
    expect(analysis.inlinedDetIds.has("m")).toBe(true);
  });
});

describe("analyzeDiscreteLatents: unsupported structures fall back", () => {
  it("ignores discrete distributions outside the marginalizable set", () => {
    const elements: GraphElement[] = [
      node({ id: "z", name: "z", distribution: "dpois", param1: "3" }),
      node({
        id: "y",
        name: "y",
        nodeType: "observed",
        distribution: "dnorm",
        param1: "z",
        param2: "1",
      }),
      edge("z", "y"),
    ];
    const analysis = analyze(elements);
    expect(analysis.latents).toHaveLength(0);
    expect(analysis.consumedFactorIds.size).toBe(0);
  });

  it("demotes a dcat latent whose support size cannot be resolved", () => {
    const elements: GraphElement[] = [
      node({ id: "z", name: "z", distribution: "dcat", param1: "softmax(eta)" }),
      node({
        id: "y",
        name: "y",
        nodeType: "observed",
        distribution: "dnorm",
        param1: "mu[z]",
        param2: "1",
      }),
      edge("z", "y"),
    ];
    const analysis = analyze(elements);
    expect(analysis.latents[0]?.tier).toBe("unsupported");
    expect(analysis.latents[0]?.reason).toContain("support size");
  });

  it("demotes chain-structured latents that reference themselves across iterations", () => {
    const elements: GraphElement[] = [
      node({ id: "plate_t", name: "tp", nodeType: "plate", loopVariable: "t", loopRange: "1:T" }),
      node({
        id: "z",
        name: "z",
        distribution: "dcat",
        param1: "P[z[t - 1], 1:2]",
        indices: "t",
        parent: "plate_t",
      }),
      node({
        id: "y",
        name: "y",
        nodeType: "observed",
        distribution: "dnorm",
        param1: "mu[z[t]]",
        param2: "1",
        indices: "t",
        parent: "plate_t",
      }),
      edge("z", "y"),
    ];
    const analysis = analyze(elements);
    expect(analysis.latents[0]?.tier).toBe("unsupported");
    expect(analysis.latents[0]?.reason).toContain("chain");
  });

  it("demotes a latent nobody reads", () => {
    const elements: GraphElement[] = [
      node({ id: "z", name: "z", distribution: "dbern", param1: "0.5" }),
      node({
        id: "y",
        name: "y",
        nodeType: "observed",
        distribution: "dnorm",
        param1: "0",
        param2: "1",
      }),
    ];
    const analysis = analyze(elements);
    expect(analysis.latents[0]?.tier).toBe("unsupported");
    expect(analysis.latents[0]?.reason).toContain("no factors");
  });

  it("demotes both plate latents when one factor reads two of them", () => {
    const base = mixtureElements();
    const elements: GraphElement[] = [
      ...base.map((el) =>
        el.type === "node" && el.id === "y"
          ? ({ ...el, param1: "mu[z[i]] + shift[u[i]]" } as GraphNode)
          : el,
      ),
      node({
        id: "u",
        name: "u",
        distribution: "dcat",
        param1: "w[1:2]",
        indices: "i",
        parent: "plate_i",
      }),
      edge("u", "y"),
    ];
    const analysis = analyze(elements);
    for (const latent of analysis.latents) {
      expect(latent.tier).toBe("unsupported");
      expect(latent.reason).toContain("another discrete latent");
    }
  });

  it("demotes cross-tier latents sharing a factor, cascading through demotions", () => {
    const elements: GraphElement[] = [
      node({ id: "plate_i", name: "ip", nodeType: "plate", loopVariable: "i", loopRange: "1:N" }),
      node({ id: "S", name: "S", distribution: "dcat", param1: "pi[1:2]" }),
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
        distribution: "dnorm",
        param1: "mu[z[i]] + shift[S]",
        param2: "1",
        indices: "i",
        parent: "plate_i",
      }),
      edge("S", "y"),
      edge("z", "y"),
    ];
    const analysis = analyze(elements);
    for (const latent of analysis.latents) {
      expect(latent.tier).toBe("unsupported");
    }
  });

  it("warns when a scalar elimination step enumerates too many configurations", () => {
    const elements: GraphElement[] = [
      node({ id: "a", name: "a", distribution: "dcat", param1: "pa[1:200]" }),
      node({ id: "b", name: "b", distribution: "dcat", param1: "pb[1:200]" }),
      node({
        id: "y",
        name: "y",
        nodeType: "observed",
        distribution: "dnorm",
        param1: "mu[a] + nu[b]",
        param2: "1",
      }),
      edge("a", "y"),
      edge("b", "y"),
    ];
    const analysis = analyze(elements);
    expect(analysis.issues.some((i) => i.includes("40000 configurations"))).toBe(true);
  });
});

describe("analyzeDiscreteLatents: review regressions", () => {
  const CAN_TRANSLATE = (d: string) => d !== "dgeom";

  it("demotes a latent whose factor has an untranslatable distribution", () => {
    const elements: GraphElement[] = [
      node({ id: "plate_i", name: "ip", nodeType: "plate", loopVariable: "i", loopRange: "1:N" }),
      node({
        id: "z",
        name: "z",
        distribution: "dbern",
        param1: "0.3",
        indices: "i",
        parent: "plate_i",
      }),
      node({
        id: "y",
        name: "y",
        nodeType: "observed",
        distribution: "dgeom",
        param1: "p[z[i] + 1]",
        indices: "i",
        parent: "plate_i",
      }),
      edge("z", "y"),
    ];
    const nodes = elements.filter((el): el is GraphNode => el.type === "node");
    const edges = elements.filter((el): el is GraphEdge => el.type === "edge");
    const analysis = analyzeDiscreteLatents(elements, buildTopologicalOrder(nodes, edges), {
      canTranslate: CAN_TRANSLATE,
    });
    expect(analysis.latents[0]?.tier).toBe("unsupported");
    expect(analysis.latents[0]?.reason).toContain("no translatable distribution");
    expect(analysis.consumedFactorIds.size).toBe(0);
  });

  it("supports a dependent scalar prior, consuming it in the parent's bucket only", () => {
    const elements: GraphElement[] = [
      node({ id: "X", name: "X", distribution: "dcat", param1: "piX[1:2]" }),
      node({ id: "Y", name: "Y", distribution: "dcat", param1: "theta[X, 1:2]" }),
      node({
        id: "y",
        name: "y",
        nodeType: "observed",
        distribution: "dnorm",
        param1: "mu[Y]",
        param2: "1",
      }),
      edge("X", "Y"),
      edge("Y", "y"),
    ];
    const analysis = analyze(elements);
    const tiers = Object.fromEntries(analysis.latents.map((l) => [l.node.id, l.tier]));
    expect(tiers).toEqual({ X: "scalar-dag", Y: "scalar-dag" });
    const plan = analysis.scalarPlan;
    expect(plan?.latents.map((n) => n.id)).toEqual(["Y", "X"]);
    // X's bucket consumes both priors (Y's prior reads X); Y's bucket gets phi_X plus the data factor.
    const stepX = plan?.steps[0];
    expect(stepX?.bucketFactors.map((f) => f.id)).toEqual(["Y", "X"]);
    expect(stepX?.scopeAfter.map((n) => n.id)).toEqual(["Y"]);
    const stepY = plan?.steps[1];
    expect(stepY?.bucketFactors.map((f) => f.id)).toEqual(["y"]);
    expect(stepY?.bucketPhis.map((n) => n.id)).toEqual(["X"]);
  });

  it("demotes a plate latent referenced in a non-substitutable form", () => {
    const elements = mixtureElements().map((el) =>
      el.type === "node" && el.id === "y" ? ({ ...el, param1: "mu[z[idx[i]]]" } as GraphNode) : el,
    );
    const analysis = analyze(elements);
    expect(analysis.latents[0]?.tier).toBe("unsupported");
    expect(analysis.latents[0]?.reason).toContain("referenced in a form other than");
  });

  it("demotes a scalar latent referenced with a subscript", () => {
    const elements: GraphElement[] = [
      node({ id: "Z", name: "Z", distribution: "dcat", param1: "pi[1:2]" }),
      node({
        id: "y",
        name: "y",
        nodeType: "observed",
        distribution: "dnorm",
        param1: "mu[Z[1]]",
        param2: "1",
      }),
      edge("Z", "y"),
    ];
    const analysis = analyze(elements);
    expect(analysis.latents[0]?.tier).toBe("unsupported");
    expect(analysis.latents[0]?.reason).toContain("subscript");
  });

  it("demotes a latent read by an unsampleable discrete latent factor", () => {
    const elements: GraphElement[] = [
      node({ id: "Z", name: "Z", distribution: "dcat", param1: "pi[1:2]" }),
      node({ id: "n", name: "n", distribution: "dpois", param1: "lambda[Z]" }),
      node({
        id: "y",
        name: "y",
        nodeType: "observed",
        distribution: "dnorm",
        param1: "mu[Z]",
        param2: "1",
      }),
      edge("Z", "n"),
      edge("Z", "y"),
    ];
    const analysis = analyze(elements);
    expect(analysis.latents[0]?.tier).toBe("unsupported");
    expect(analysis.latents[0]?.reason).toContain("discrete latent Stan cannot sample");
  });

  it("resolves a numeric dcat slice not starting at 1, with position-based values", () => {
    const elements: GraphElement[] = [
      node({ id: "Z", name: "Z", distribution: "dcat", param1: "w[2:3]" }),
      node({
        id: "y",
        name: "y",
        nodeType: "observed",
        distribution: "dnorm",
        param1: "mu[Z]",
        param2: "1",
      }),
      edge("Z", "y"),
    ];
    const analysis = analyze(elements);
    expect(analysis.latents[0]?.tier).toBe("scalar-dag");
    expect(analysis.latents[0]?.support).toEqual({ size: "2", lo: 1 });
  });

  it("demotes a dcat latent whose symbolic slice does not start at 1", () => {
    const elements: GraphElement[] = [
      node({ id: "Z", name: "Z", distribution: "dcat", param1: "w[a:b]" }),
      node({
        id: "y",
        name: "y",
        nodeType: "observed",
        distribution: "dnorm",
        param1: "mu[Z]",
        param2: "1",
      }),
      edge("Z", "y"),
    ];
    const analysis = analyze(elements);
    expect(analysis.latents[0]?.tier).toBe("unsupported");
    expect(analysis.latents[0]?.reason).toContain("support size");
  });

  it("resolves dbin support from a literal and a data-scalar trial count", () => {
    const make = (n: string): GraphElement[] => [
      node({ id: "plate_i", name: "ip", nodeType: "plate", loopVariable: "i", loopRange: "1:N" }),
      node({
        id: "z",
        name: "z",
        distribution: "dbin",
        param1: "phi",
        param2: n,
        indices: "i",
        parent: "plate_i",
      }),
      node({
        id: "y",
        name: "y",
        nodeType: "observed",
        distribution: "dnorm",
        param1: "mu[z[i] + 1]",
        param2: "1",
        indices: "i",
        parent: "plate_i",
      }),
      edge("z", "y"),
    ];
    const literal = analyze(make("3"));
    expect(literal.latents[0]?.tier).toBe("iid-plate");
    expect(literal.latents[0]?.support).toEqual({ size: "4", lo: 0 });
    const symbolic = analyze(make("n"));
    expect(symbolic.latents[0]?.support).toEqual({ size: "(n + 1)", lo: 0 });
  });

  it("demotes a dbin latent whose trial count is a model parameter", () => {
    const elements: GraphElement[] = [
      node({ id: "n", name: "n", distribution: "dpois", param1: "5" }),
      node({ id: "z", name: "z", distribution: "dbin", param1: "0.5", param2: "n" }),
      node({
        id: "y",
        name: "y",
        nodeType: "observed",
        distribution: "dnorm",
        param1: "mu[z + 1]",
        param2: "1",
      }),
      edge("n", "z"),
      edge("z", "y"),
    ];
    const analysis = analyze(elements);
    const z = analysis.latents.find((l) => l.node.id === "z");
    expect(z?.tier).toBe("unsupported");
    expect(z?.reason).toContain("support size");
  });

  it("demotes a latent whose helper names collide with user variables", () => {
    const elements: GraphElement[] = [
      ...mixtureElements(),
      node({ id: "clash", name: "z_lp", nodeType: "constant" }),
    ];
    const analysis = analyze(elements);
    expect(analysis.latents[0]?.tier).toBe("unsupported");
    expect(analysis.latents[0]?.reason).toContain("collide");
  });

  it("demotes a chain hidden behind a deterministic node", () => {
    const elements: GraphElement[] = [
      node({ id: "plate_t", name: "tp", nodeType: "plate", loopVariable: "t", loopRange: "1:T" }),
      node({
        id: "z",
        name: "z",
        distribution: "dcat",
        param1: "w[1:2]",
        indices: "t",
        parent: "plate_t",
      }),
      node({
        id: "m",
        name: "m",
        nodeType: "deterministic",
        equation: "mu[z[t - 1]]",
        indices: "t",
        parent: "plate_t",
      }),
      node({
        id: "y",
        name: "y",
        nodeType: "observed",
        distribution: "dnorm",
        param1: "m[t]",
        param2: "1",
        indices: "t",
        parent: "plate_t",
      }),
      edge("z", "m"),
      edge("m", "y"),
    ];
    const analysis = analyze(elements);
    expect(analysis.latents[0]?.tier).toBe("unsupported");
  });
});

describe("marginalizedLatentNames", () => {
  it("lists only the latents that leave the parameter space", () => {
    const elements = [...mixedDagElements(), ...mixtureElements()];
    const nodes = elements.filter((el): el is GraphNode => el.type === "node");
    const edges = elements.filter((el): el is GraphEdge => el.type === "edge");
    const names = marginalizedLatentNames(elements, buildTopologicalOrder(nodes, edges));
    expect(names.sort()).toEqual(["C", "X", "Z", "z"]);
  });
});
