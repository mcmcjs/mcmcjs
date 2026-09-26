import { describe, expect, it } from "vitest";
import type { GraphElement } from "../src/core/types";
import { validateGraph } from "../src/core/validate";

describe("variable names by language", () => {
  const stochastic = (name: string): GraphElement[] => [
    {
      id: "n",
      name,
      type: "node",
      nodeType: "stochastic",
      distribution: "dnorm",
      param1: "0",
      param2: "1",
    },
  ];
  const nameIssues = (name: string, language?: "bugs" | "stan") =>
    validateGraph(stochastic(name), {}, language ? { language } : {}).filter(
      (i) => i.field === "name",
    );

  it("BUGS is the default: dots allowed, underscores not", () => {
    expect(nameIssues("tau.c")).toEqual([]);
    expect(nameIssues("tau_c").map((i) => i.message)).toEqual([
      "Base name 'tau_c' is not a valid BUGS variable name.",
    ]);
  });

  it("Stan: underscores allowed, dots not, and no trailing double underscore", () => {
    expect(nameIssues("tau_c", "stan")).toEqual([]);
    expect(nameIssues("y_rep", "stan")).toEqual([]);
    expect(nameIssues("tau.c", "stan").map((i) => i.message)).toEqual([
      "Base name 'tau.c' is not a valid Stan variable name.",
    ]);
    expect(nameIssues("lp__", "stan")).toHaveLength(1);
  });

  it("both reject a name that starts with a digit", () => {
    expect(nameIssues("1x")).toHaveLength(1);
    expect(nameIssues("1x", "stan")).toHaveLength(1);
  });
});

describe("constructs a parsed program produces", () => {
  const n = (x: Partial<GraphElement> & { id: string }): GraphElement =>
    ({ type: "node", ...x }) as GraphElement;
  const e = (source: string, target: string): GraphElement => ({
    id: `${source}_${target}`,
    type: "edge",
    source,
    target,
  });

  it("an observed node whose value is an equation needs no data, and its equation's parents are not distribution inputs", () => {
    // Dogs: y[i, j] <- 1 - Y[i, j] then y[i, j] ~ dbern(p[i, j]).
    const els = [
      n({ id: "Y", name: "Y", nodeType: "constant" }),
      n({ id: "p", name: "p", nodeType: "deterministic", equation: "0.5" }),
      n({
        id: "y",
        name: "y",
        nodeType: "observed",
        observed: true,
        equation: "1 - Y",
        distribution: "dbern",
        param1: "p",
      }),
      e("Y", "y"),
      e("p", "y"),
    ];
    expect(validateGraph(els, { Y: [1, 0] })).toEqual([]);
  });

  it("a censoring bound is not a distribution input", () => {
    const els = [
      n({ id: "r", name: "r", nodeType: "stochastic", distribution: "dexp", param1: "1" }),
      n({ id: "mu", name: "mu", nodeType: "stochastic", distribution: "dexp", param1: "1" }),
      n({ id: "cen", name: "t.cen", nodeType: "constant" }),
      n({
        id: "t",
        name: "t",
        nodeType: "observed",
        observed: true,
        distribution: "dweib",
        param1: "r",
        param2: "mu",
        censorLower: "t.cen",
      }),
      e("r", "t"),
      e("mu", "t"),
      e("cen", "t"),
    ];
    expect(validateGraph(els, { t: [1], "t.cen": [0] })).toEqual([]);
  });

  it("a scientific-notation literal in an equation is not a variable, and a called name is a function", () => {
    const els = [
      n({
        id: "mu",
        name: "mu",
        nodeType: "stochastic",
        distribution: "dnorm",
        param1: "0",
        param2: "1",
      }),
      n({ id: "tau", name: "tau", nodeType: "deterministic", equation: "1.0E-6" }),
      n({ id: "p", name: "p", nodeType: "deterministic", equation: "inv_logit(mu) + 2.5e3" }),
      e("mu", "p"),
    ];
    expect(validateGraph(els, {}, { language: "stan" })).toEqual([]);
  });

  it("a constraint on the first element beside a plate from 2 is not an overlap, even when another plate reuses the loop variable from 1", () => {
    // Alligators: alpha[1] <- 0; for (k in 2:K) alpha[k] ~ dnorm; and elsewhere for (k in 1:K).
    const els = [
      n({ id: "plate_k", name: "Plate.k", nodeType: "plate", loopVariable: "k", loopRange: "1:K" }),
      n({
        id: "plate_k_2",
        name: "Plate.k",
        nodeType: "plate",
        loopVariable: "k",
        loopRange: "2:K",
      }),
      n({ id: "a1", name: "alpha", indices: "1", nodeType: "deterministic", equation: "0" }),
      n({
        id: "ak",
        name: "alpha",
        indices: "k",
        parent: "plate_k_2",
        nodeType: "stochastic",
        distribution: "dnorm",
        param1: "0",
        param2: "1.0E-5",
      }),
      n({
        id: "m",
        name: "m",
        indices: "k",
        parent: "plate_k",
        nodeType: "deterministic",
        equation: "k",
      }),
    ];
    expect(validateGraph(els, {}).filter((i) => /already defined/.test(i.message))).toEqual([]);
  });

  it("still flags two statements that do cover the same element", () => {
    const els = [
      n({ id: "plate_k", name: "Plate.k", nodeType: "plate", loopVariable: "k", loopRange: "1:K" }),
      n({ id: "a1", name: "alpha", indices: "1", nodeType: "deterministic", equation: "0" }),
      n({
        id: "ak",
        name: "alpha",
        indices: "k",
        parent: "plate_k",
        nodeType: "stochastic",
        distribution: "dnorm",
        param1: "0",
        param2: "1",
      }),
    ];
    expect(validateGraph(els, {}).filter((i) => /already defined/.test(i.message))).toHaveLength(1);
  });

  it("fixing elements of an observed multivariate node is the data-transform idiom, not a redefinition", () => {
    // Endo: Y[i, 1] <- 1; Y[i, 2] <- 0; Y[i, 1:J] ~ dmulti(p[i, 1:J], 1).
    const els = [
      n({ id: "plate_i", name: "Plate.i", nodeType: "plate", loopVariable: "i", loopRange: "1:I" }),
      n({
        id: "y1",
        name: "Y",
        indices: "i, 1",
        parent: "plate_i",
        nodeType: "deterministic",
        equation: "1",
      }),
      n({
        id: "y2",
        name: "Y",
        indices: "i, 2",
        parent: "plate_i",
        nodeType: "deterministic",
        equation: "0",
      }),
      n({
        id: "yv",
        name: "Y",
        indices: "i, 1:J",
        parent: "plate_i",
        nodeType: "observed",
        observed: true,
        distribution: "dmulti",
        param1: "p[i, 1:J]",
        param2: "1",
      }),
    ];
    expect(
      validateGraph(els, { Y: [[1, 0]] }).filter((i) => /already defined/.test(i.message)),
    ).toEqual([]);
    // The observed vector has no data of its own: the model writes it.
    expect(validateGraph(els, {}).filter((i) => /no data found/.test(i.message))).toEqual([]);
  });

  it("in Stan an assignment followed by a prior on the same element is legal; in BUGS it is a redefinition", () => {
    const els = [
      n({ id: "plate_k", name: "Plate.k", nodeType: "plate", loopVariable: "k", loopRange: "2:4" }),
      n({
        id: "b2",
        name: "beta_dis",
        indices: "2",
        nodeType: "deterministic",
        equation: "beta_dis_free[1]",
      }),
      n({
        id: "bk",
        name: "beta_dis",
        indices: "k",
        parent: "plate_k",
        nodeType: "stochastic",
        distribution: "dnorm",
        param1: "0",
        param2: "1",
      }),
    ];
    const overlaps = (language: "bugs" | "stan") =>
      validateGraph(els, {}, { language }).filter((i) => /already defined/.test(i.message));
    expect(overlaps("stan")).toEqual([]);
    expect(overlaps("bugs")).toHaveLength(1);
  });
});

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

describe("validateGraph: index-range overlap between same-name nodes", () => {
  const plate = (id: string, v: string, range: string, parent?: string): GraphElement =>
    node({ id, name: `Plate ${v}`, nodeType: "plate", loopVariable: v, loopRange: range, parent });

  it("accepts a seeded recursion over disjoint ranges (the chain idiom)", () => {
    const issues = validateGraph(
      [
        node({
          id: "z1",
          name: "z",
          nodeType: "stochastic",
          indices: "1",
          distribution: "dcat",
          param1: "pi0[1:2]",
        }),
        plate("plate_t", "t", "2:T"),
        node({
          id: "zt",
          name: "z",
          nodeType: "stochastic",
          parent: "plate_t",
          indices: "t",
          distribution: "dcat",
          param1: "P[z[t - 1], 1:2]",
        }),
      ],
      {},
    );
    expect(issues.filter((i) => i.message.includes("already defined"))).toEqual([]);
  });

  it("accepts the Ice idiom: a pinned first element plus a stochastic tail", () => {
    const issues = validateGraph(
      [
        node({ id: "a1", name: "alpha", nodeType: "deterministic", indices: "1", equation: "0.0" }),
        plate("plate_j", "j", "2:Nage"),
        node({
          id: "aj",
          name: "alpha",
          nodeType: "stochastic",
          parent: "plate_j",
          indices: "j",
          distribution: "dnorm",
          param1: "0",
          param2: "1.0E-6",
        }),
      ],
      {},
    );
    expect(issues.filter((i) => i.message.includes("already defined"))).toEqual([]);
  });

  it("flags a first element that the plate range already covers", () => {
    const issues = validateGraph(
      [
        node({
          id: "z1",
          name: "z",
          nodeType: "stochastic",
          indices: "1",
          distribution: "dcat",
          param1: "pi0[1:2]",
        }),
        plate("plate_i", "i", "1:N"),
        node({
          id: "zi",
          name: "z",
          nodeType: "stochastic",
          parent: "plate_i",
          indices: "i",
          distribution: "dcat",
          param1: "pi0[1:2]",
        }),
      ],
      {},
    );
    expect(issues.some((i) => i.message.includes("already defined"))).toBe(true);
  });

  it("flags two nodes in the same plate defining one variable", () => {
    const issues = validateGraph(
      [
        plate("plate_i", "i", "1:N"),
        node({
          id: "a",
          name: "x",
          nodeType: "stochastic",
          parent: "plate_i",
          indices: "i",
          distribution: "dnorm",
          param1: "0",
          param2: "1",
        }),
        node({
          id: "b",
          name: "x",
          nodeType: "deterministic",
          parent: "plate_i",
          indices: "i",
          equation: "2",
        }),
      ],
      {},
    );
    expect(issues.some((i) => i.message.includes("already defined"))).toBe(true);
  });

  it("flags two scalar nodes sharing a name", () => {
    const issues = validateGraph(
      [
        node({
          id: "m1",
          name: "mu",
          nodeType: "stochastic",
          distribution: "dnorm",
          param1: "0",
          param2: "1",
        }),
        node({ id: "m2", name: "mu", nodeType: "deterministic", equation: "3" }),
      ],
      {},
    );
    expect(issues.some((i) => i.message.includes("already defined"))).toBe(true);
  });

  it("treats an index embedded in the node name as that node's coverage", () => {
    const issues = validateGraph(
      [
        node({
          id: "m1",
          name: "mu[1]",
          nodeType: "stochastic",
          distribution: "dnorm",
          param1: "0",
          param2: "1",
        }),
        node({
          id: "m2",
          name: "mu[2]",
          nodeType: "stochastic",
          distribution: "dnorm",
          param1: "0",
          param2: "1",
        }),
      ],
      {},
    );
    expect(issues.filter((i) => i.message.includes("already defined"))).toEqual([]);
  });

  it("flags the same index embedded in two node names", () => {
    const issues = validateGraph(
      [
        node({
          id: "m1",
          name: "mu[1]",
          nodeType: "stochastic",
          distribution: "dnorm",
          param1: "0",
          param2: "1",
        }),
        node({ id: "m2", name: "mu[1]", nodeType: "deterministic", equation: "3" }),
      ],
      {},
    );
    expect(issues.some((i) => i.message.includes("already defined"))).toBe(true);
  });

  it("does not invent a conflict from unknown index expressions", () => {
    const issues = validateGraph(
      [
        node({
          id: "a",
          name: "x",
          nodeType: "deterministic",
          indices: "idx[k]",
          equation: "1",
        }),
        node({
          id: "b",
          name: "x",
          nodeType: "deterministic",
          indices: "other[k]",
          equation: "2",
        }),
      ],
      {},
    );
    expect(issues.filter((i) => i.message.includes("already defined"))).toEqual([]);
  });
});
