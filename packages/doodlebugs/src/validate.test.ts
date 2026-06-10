import { describe, expect, it } from "vitest";
import type { GraphElement } from "./types";
import { validateGraph } from "./validate";

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
