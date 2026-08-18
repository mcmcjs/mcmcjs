import { describe, expect, it } from "vitest";
import type { GraphElement } from "../src/core/types";
import { validateGraph } from "../src/core/validate";

const node = (n: Partial<GraphElement> & { id: string }): GraphElement =>
  ({ type: "node", ...n }) as GraphElement;
const edge = (id: string, source: string, target: string): GraphElement => ({
  id,
  type: "edge",
  source,
  target,
});

// A valid seeds-like slice: plate, observed outcome, deterministic link, priors.
const VALID: GraphElement[] = [
  node({
    id: "tau",
    name: "tau",
    nodeType: "stochastic",
    distribution: "dgamma",
    param1: "0.001",
    param2: "0.001",
  }),
  node({ id: "sigma", name: "sigma", nodeType: "deterministic", equation: "1 / sqrt(tau)" }),
  node({ id: "plate_i", name: "Plate i", nodeType: "plate", loopVariable: "i", loopRange: "1:N" }),
  node({
    id: "b",
    name: "b",
    nodeType: "stochastic",
    parent: "plate_i",
    indices: "i",
    distribution: "dnorm",
    param1: "0.0",
    param2: "tau",
  }),
  node({
    id: "y",
    name: "y",
    nodeType: "observed",
    parent: "plate_i",
    indices: "i",
    distribution: "dnorm",
    param1: "b",
    param2: "tau",
    observed: true,
  }),
  edge("e_tau_sigma", "tau", "sigma"),
  edge("e_tau_b", "tau", "b"),
  edge("e_b_y", "b", "y"),
  edge("e_tau_y", "tau", "y"),
];
const DATA = { y: [1, 2, 3], N: 3 };

describe("validateGraph", () => {
  it("accepts a valid graph", () => {
    expect(validateGraph(VALID, DATA)).toEqual([]);
  });

  it("flags a distribution parameter-count mismatch", () => {
    const issues = validateGraph(
      [node({ id: "m", name: "m", nodeType: "stochastic", distribution: "dnorm", param1: "0" })],
      {},
    );
    expect(issues).toEqual([
      {
        nodeId: "m",
        field: "distribution",
        message: "Invalid number of inputs. Normal (dnorm) expects 2, but found 1.",
      },
    ]);
  });

  it("counts an input once when it arrives by edge as a linked parameter", () => {
    const issues = validateGraph(
      [
        node({
          id: "tau",
          name: "tau",
          nodeType: "stochastic",
          distribution: "dgamma",
          param1: "1",
          param2: "1",
        }),
        node({
          id: "x",
          name: "x",
          nodeType: "stochastic",
          distribution: "dnorm",
          param1: "0.0",
          param2: "tau",
        }),
        edge("e", "tau", "x"),
      ],
      {},
    );
    expect(issues).toEqual([]);
  });

  it("counts an input once when a parent is referenced nested inside a parameter", () => {
    const issues = validateGraph(
      [
        node({ id: "pi", name: "pi", nodeType: "constant" }),
        node({
          id: "plate_i",
          name: "Plate i",
          nodeType: "plate",
          loopVariable: "i",
          loopRange: "1:N",
        }),
        node({
          id: "z",
          name: "z",
          nodeType: "stochastic",
          parent: "plate_i",
          indices: "i",
          distribution: "dcat",
          param1: "pi[1:2]",
        }),
        node({
          id: "y",
          name: "y",
          nodeType: "observed",
          parent: "plate_i",
          indices: "i",
          distribution: "dnorm",
          param1: "mu[z[i]]",
          param2: "tau",
          observed: true,
        }),
        edge("e_pi_z", "pi", "z"),
        edge("e_z_y", "z", "y"),
      ],
      { y: [1, 2, 3], N: 3, mu: [0, 1], tau: 1 },
    );
    expect(issues).toEqual([]);
  });

  it("counts one input per distinct unreferenced parent, ignoring same-name duplicates", () => {
    const chain: GraphElement[] = [
      node({
        id: "z1",
        name: "z",
        nodeType: "stochastic",
        indices: "1",
        distribution: "dcat",
        param1: "pi0[1:2]",
      }),
      node({
        id: "plate_t",
        name: "Plate t",
        nodeType: "plate",
        loopVariable: "t",
        loopRange: "2:T",
      }),
      node({
        id: "zt",
        name: "z",
        nodeType: "stochastic",
        parent: "plate_t",
        indices: "t",
        distribution: "dcat",
        param1: "P[z[t - 1], 1:2]",
      }),
      node({
        id: "plate_s",
        name: "Plate s",
        nodeType: "plate",
        loopVariable: "s",
        loopRange: "1:T",
      }),
      node({
        id: "y",
        name: "y",
        nodeType: "observed",
        parent: "plate_s",
        indices: "s",
        distribution: "dnorm",
        param1: "mu[z[s]]",
        param2: "tau",
        observed: true,
      }),
      edge("e_z1_zt", "z1", "zt"),
      edge("e_z1_y", "z1", "y"),
      edge("e_zt_y", "zt", "y"),
    ];
    expect(validateGraph(chain, { y: [1, 2], T: 2, mu: [0, 1], tau: 1, pi0: [0.5, 0.5] })).toEqual(
      [],
    );
  });

  it("still flags a genuinely missing input", () => {
    const issues = validateGraph(
      [
        node({
          id: "x",
          name: "x",
          nodeType: "stochastic",
          distribution: "dnorm",
          param1: "0.0",
        }),
      ],
      {},
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]?.message).toContain("expects 2, but found 1");
  });

  it("requires deterministic nodes to have an equation", () => {
    const issues = validateGraph([node({ id: "s", name: "s", nodeType: "deterministic" })], {});
    expect(issues[0]).toMatchObject({ nodeId: "s", field: "equation" });
  });

  it("flags an equation variable that is not a parent, data key, or loop index", () => {
    const issues = validateGraph(
      [node({ id: "p", name: "p", nodeType: "deterministic", equation: "alpha + 1" })],
      {},
    );
    expect(issues[0]?.message).toBe(
      "Variable 'alpha' in equation is not a parent, data variable, or an available loop index.",
    );
  });

  it("allows equation variables supplied as data or enclosing loop indices", () => {
    const issues = validateGraph(
      [
        node({ id: "plate_i", name: "P", nodeType: "plate", loopVariable: "i", loopRange: "1:N" }),
        node({
          id: "mu",
          name: "mu",
          nodeType: "deterministic",
          parent: "plate_i",
          indices: "i",
          equation: "x[i] * 2",
        }),
      ],
      { x: [1, 2] },
    );
    expect(issues).toEqual([]);
  });

  it("flags an observed node with no backing data", () => {
    const issues = validateGraph(
      [node({ id: "y", name: "y", nodeType: "observed", distribution: "dflat", observed: true })],
      {},
    );
    expect(issues).toEqual([
      {
        nodeId: "y",
        field: "name",
        message: "Node is marked as observed, but no data found for 'y'.",
      },
    ]);
  });

  it("flags an invalid BUGS variable name but exempts plates", () => {
    const issues = validateGraph(
      [
        node({ id: "bad", name: "2x", nodeType: "constant" }),
        node({ id: "pl", name: "Plate i", nodeType: "plate", loopVariable: "i", loopRange: "1:N" }),
      ],
      {},
    );
    expect(issues).toEqual([
      {
        nodeId: "bad",
        field: "name",
        message: "Base name '2x' is not a valid BUGS variable name.",
      },
    ]);
  });

  it("skips the parameter check for an unknown distribution", () => {
    const issues = validateGraph(
      [node({ id: "u", name: "u", nodeType: "stochastic", distribution: "dmystery" })],
      {},
    );
    expect(issues).toEqual([]);
  });
});
