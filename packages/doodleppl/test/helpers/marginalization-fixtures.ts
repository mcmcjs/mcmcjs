import type { GraphEdge, GraphElement, GraphNode } from "../../src/core/types";

export const node = (n: Partial<GraphNode> & { id: string; name: string }): GraphElement =>
  ({ type: "node", nodeType: "stochastic", ...n }) as GraphNode;

export const edge = (source: string, target: string): GraphElement =>
  ({ id: `${source}->${target}`, type: "edge", source, target }) as GraphEdge;

/** Two-component mixture: z[i] ~ dcat(w[1:2]); y[i] ~ dnorm(mu[z[i]], 1/sigma[z[i]]^2) in plate i. */
export function mixtureElements(): GraphElement[] {
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
    node({
      id: "sigma",
      name: "sigma",
      distribution: "dexp",
      param1: "1",
      indices: "k",
      parent: "plate_k",
    }),
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
      param2: "1 / (sigma[z[i]] * sigma[z[i]])",
      indices: "i",
      parent: "plate_i",
    }),
    edge("w", "z"),
    edge("z", "y"),
    edge("mu", "y"),
    edge("sigma", "y"),
  ];
}

/**
 * The mixed DAG from the auto-marginalization paper, with a dbern gate:
 * X -> A -> B -> D, A -> pC -> C -> D, Z -> D; A, B continuous, D observed.
 */
export function mixedDagElements(): GraphElement[] {
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

/** Gaussian-emission HMM: z[1] ~ dcat(pi0); z[t] ~ dcat(P[z[t-1], 1:K]); y[s] ~ dnorm(mu[z[s]], tau). */
export function hmmElements(): GraphElement[] {
  return [
    node({ id: "z1", name: "z", indices: "1", distribution: "dcat", param1: "pi0[1:K]" }),
    node({
      id: "plate_t",
      name: "t plate",
      nodeType: "plate",
      loopVariable: "t",
      loopRange: "2:T",
    }),
    node({
      id: "zt",
      name: "z",
      parent: "plate_t",
      indices: "t",
      distribution: "dcat",
      param1: "P[z[t - 1], 1:K]",
    }),
    node({
      id: "plate_s",
      name: "s plate",
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
    }),
    node({
      id: "plate_k",
      name: "k plate",
      nodeType: "plate",
      loopVariable: "k",
      loopRange: "1:K",
    }),
    node({
      id: "mu",
      name: "mu",
      parent: "plate_k",
      indices: "k",
      distribution: "dnorm",
      param1: "0",
      param2: "0.01",
    }),
    node({ id: "tau", name: "tau", distribution: "dgamma", param1: "1", param2: "1" }),
    edge("z1", "zt"),
    edge("z1", "y"),
    edge("zt", "y"),
    edge("mu", "y"),
    edge("tau", "y"),
  ];
}

export const hmmData = {
  T: 6,
  K: 2,
  y: [-1.4, 1.6, 1.2, -1.1, 1.9, -1.7],
  pi0: [0.5, 0.5],
  P: [
    [0.9, 0.1],
    [0.2, 0.8],
  ],
};

export const hmmPoints = [
  { mu: [-1.5, 1.5], tau: 4.0 },
  { mu: [-0.9, 2.1], tau: 1.3 },
  { mu: [-2.2, 0.7], tau: 6.5 },
];

/** Mixture over a nested plate: z[i,j] ~ dcat(w); y[i,j] ~ dnorm(mu[z[i,j]], 1). */
export function nestedMixtureElements(): GraphElement[] {
  return [
    node({ id: "w", name: "w", nodeType: "constant" }),
    node({
      id: "plate_i",
      name: "i plate",
      nodeType: "plate",
      loopVariable: "i",
      loopRange: "1:N",
    }),
    node({
      id: "plate_j",
      name: "j plate",
      nodeType: "plate",
      loopVariable: "j",
      loopRange: "1:M",
      parent: "plate_i",
    }),
    node({
      id: "plate_k",
      name: "k plate",
      nodeType: "plate",
      loopVariable: "k",
      loopRange: "1:2",
    }),
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
      indices: "i,j",
      parent: "plate_j",
    }),
    node({
      id: "y",
      name: "y",
      nodeType: "observed",
      distribution: "dnorm",
      param1: "mu[z[i,j]]",
      param2: "1",
      indices: "i,j",
      parent: "plate_j",
    }),
    edge("w", "z"),
    edge("z", "y"),
    edge("mu", "y"),
  ];
}

export const nestedMixtureData = {
  N: 3,
  M: 2,
  w: [0.35, 0.65],
  y: [
    [-1.9, 2.1],
    [1.7, -2.2],
    [0.3, 1.4],
  ],
};

export const nestedMixturePoints = [{ mu: [-2.0, 2.0] }, { mu: [-1.1, 2.7] }, { mu: [0.4, -0.6] }];

/** The mixture drawn idiomatically: the latent reaches y only through deterministic nodes. */
export function mixtureDetElements(): GraphElement[] {
  const base = mixtureElements().filter(
    (el) => !(el.type === "edge" && ["z->y", "mu->y", "sigma->y"].includes(el.id)),
  );
  return [
    ...base.map((el) =>
      el.type === "node" && el.id === "y"
        ? ({ ...el, param1: "muY[i]", param2: "tauY[i]" } as GraphNode)
        : el,
    ),
    node({
      id: "muY",
      name: "muY",
      nodeType: "deterministic",
      equation: "mu[z[i]]",
      indices: "i",
      parent: "plate_i",
    }),
    node({
      id: "tauY",
      name: "tauY",
      nodeType: "deterministic",
      equation: "1 / (sigma[z[i]] * sigma[z[i]])",
      indices: "i",
      parent: "plate_i",
    }),
    edge("z", "muY"),
    edge("mu", "muY"),
    edge("z", "tauY"),
    edge("sigma", "tauY"),
    edge("muY", "y"),
    edge("tauY", "y"),
  ];
}

/** Dependent discrete priors: X ~ dcat(piX); Y ~ dcat(theta[X, 1:2]); yobs ~ dnorm(mu[Y], tau(sigma)). */
export function chainDagElements(): GraphElement[] {
  return [
    node({ id: "X", name: "X", distribution: "dcat", param1: "piX[1:2]" }),
    node({ id: "Y", name: "Y", distribution: "dcat", param1: "theta[X, 1:2]" }),
    node({ id: "sigma", name: "sigma", distribution: "dexp", param1: "1" }),
    node({
      id: "yobs",
      name: "yobs",
      nodeType: "observed",
      distribution: "dnorm",
      param1: "mu[Y]",
      param2: "1 / (sigma * sigma)",
    }),
    edge("X", "Y"),
    edge("Y", "yobs"),
    edge("sigma", "yobs"),
  ];
}

export const mixtureData = {
  N: 6,
  y: [-2.1, 1.8, -1.7, 2.3, 0.4, -2.5],
  w: [0.3, 0.7],
};

export const mixedDagData = {
  piX: [0.4, 0.6],
  piZ: [0.3, 0.7],
  muX: [-1.0, 1.0],
  tauA: 1.0,
  tauB: 4.0,
  alpha0: 0.2,
  alpha1: 1.5,
  deltaC: [-0.8, 0.8],
  deltaZ: [-0.5, 0.5],
  tauD: 9.0,
  D: 0.7,
};

/** Constrained-space test points, named per parameter. */
export const mixturePoints = [
  { mu: [-2.0, 2.0], sigma: [1.0, 0.8] },
  { mu: [-1.2, 2.6], sigma: [0.5, 1.9] },
  { mu: [0.3, -0.4], sigma: [2.2, 0.3] },
];

export const mixedDagPoints = [
  { A: 0.1, B: 0.3 },
  { A: -1.2, B: 0.8 },
  { A: 2.0, B: -0.5 },
];

/** The mixture with z partially observed: entries with data score pointwise. */
export function mixturePartialElements(): GraphElement[] {
  return mixtureElements().map((el) =>
    el.type === "node" && el.id === "z" ? ({ ...el, nodeType: "observed" } as GraphNode) : el,
  );
}

export const mixturePartialData = {
  ...mixtureData,
  z: [2, null, 1, null, null, 2] as (number | null)[],
};

/** Binomial count latent: phi ~ dbeta(2,2); z[i] ~ dbin(phi, 3); y[i] ~ dnorm(mu0 + delta * z[i], 1). */
export function binMixElements(): GraphElement[] {
  return [
    node({
      id: "plate_i",
      name: "i plate",
      nodeType: "plate",
      loopVariable: "i",
      loopRange: "1:N",
    }),
    node({ id: "phi", name: "phi", distribution: "dbeta", param1: "2", param2: "2" }),
    node({
      id: "z",
      name: "z",
      distribution: "dbin",
      param1: "phi",
      param2: "3",
      indices: "i",
      parent: "plate_i",
    }),
    node({
      id: "y",
      name: "y",
      nodeType: "observed",
      distribution: "dnorm",
      param1: "mu0 + delta * z[i]",
      param2: "1",
      indices: "i",
      parent: "plate_i",
    }),
    edge("phi", "z"),
    edge("z", "y"),
  ];
}

export const binMixData = {
  N: 5,
  y: [0.2, 2.1, 3.3, 1.2, 0.4],
  mu0: 0.1,
  delta: 1.1,
};

export const binMixPoints = [{ phi: 0.4 }, { phi: 0.7 }, { phi: 0.15 }];

export const chainDagData = {
  piX: [0.4, 0.6],
  theta: [
    [0.9, 0.1],
    [0.2, 0.8],
  ],
  mu: [-1.5, 1.5],
  yobs: 0.7,
};

export const chainDagPoints = [{ sigma: 0.8 }, { sigma: 1.6 }, { sigma: 0.4 }];
