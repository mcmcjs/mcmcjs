import { describe, expect, it } from "vitest";
import { generateBugsModel } from "../src/codegen/bugs";
import type { GraphElement } from "../src/core/types";

const node = (n: Partial<GraphElement> & { id: string }): GraphElement =>
  ({ type: "node", ...n }) as GraphElement;
const edge = (id: string, source: string, target: string): GraphElement => ({
  id,
  type: "edge",
  source,
  target,
});

describe("generateBugsModel", () => {
  it("emits a hierarchical model: plate loop, stochastic, deterministic, observed; omits constants", () => {
    const elements: GraphElement[] = [
      node({
        id: "mu",
        name: "mu",
        nodeType: "stochastic",
        distribution: "dnorm",
        param1: "0",
        param2: "0.0001",
      }),
      node({
        id: "tau",
        name: "tau",
        nodeType: "stochastic",
        distribution: "dgamma",
        param1: "0.01",
        param2: "0.01",
      }),
      node({ id: "sigma", name: "sigma", nodeType: "deterministic", equation: "1 / sqrt(tau)" }),
      node({
        id: "plate_i",
        name: "Plate i",
        nodeType: "plate",
        loopVariable: "i",
        loopRange: "1:N",
      }),
      node({ id: "x", name: "x", nodeType: "constant", parent: "plate_i", indices: "i" }),
      node({
        id: "y",
        name: "y",
        nodeType: "observed",
        parent: "plate_i",
        indices: "i",
        distribution: "dnorm",
        param1: "mu",
        param2: "tau",
        observed: true,
      }),
      edge("e_tau_sigma", "tau", "sigma"),
      edge("e_mu_y", "mu", "y"),
      edge("e_tau_y", "tau", "y"),
    ];

    expect(generateBugsModel(elements)).toBe(
      [
        "model {",
        "  for (i in 1:N) {",
        "    y[i] ~ dnorm(mu, tau)",
        "  }",
        "  mu ~ dnorm(0, 0.0001)",
        "  tau ~ dgamma(0.01, 0.01)",
        "  sigma <- 1 / sqrt(tau)",
        "}",
      ].join("\n"),
    );
  });

  it("auto-indexes a parameter that names a node carrying indices", () => {
    const elements: GraphElement[] = [
      node({
        id: "plate_j",
        name: "Plate j",
        nodeType: "plate",
        loopVariable: "j",
        loopRange: "1:J",
      }),
      node({
        id: "theta",
        name: "theta",
        nodeType: "stochastic",
        parent: "plate_j",
        indices: "j",
        distribution: "dnorm",
        param1: "0",
        param2: "1",
      }),
      node({
        id: "y",
        name: "y",
        nodeType: "observed",
        parent: "plate_j",
        indices: "j",
        distribution: "dnorm",
        param1: "theta",
        param2: "1",
        observed: true,
      }),
      edge("e_theta_y", "theta", "y"),
    ];
    // `theta` resolves to a node with indices "j", so it is rendered theta[j].
    expect(generateBugsModel(elements)).toContain("y[j] ~ dnorm(theta[j], 1)");
  });

  it("appends a C(lower, upper) censoring suffix", () => {
    const elements: GraphElement[] = [
      node({
        id: "t",
        name: "t",
        nodeType: "stochastic",
        distribution: "dweib",
        param1: "r",
        param2: "mu",
        censorLower: "c",
        censorUpper: "",
      }),
    ];
    expect(generateBugsModel(elements)).toContain("t ~ dweib(r, mu)C(c,)");
  });

  it("emits an optional data-transform line before a stochastic statement", () => {
    const elements: GraphElement[] = [
      node({
        id: "z",
        name: "z",
        nodeType: "stochastic",
        distribution: "dnorm",
        param1: "0",
        param2: "1",
        equation: "log(y)",
      }),
    ];
    expect(generateBugsModel(elements)).toBe(
      ["model {", "  z <- log(y)", "  z ~ dnorm(0, 1)", "}"].join("\n"),
    );
  });

  it("returns an empty model for a graph with no nodes", () => {
    expect(generateBugsModel([])).toBe("model {\n}");
  });
});
