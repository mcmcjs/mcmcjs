import { describe, expect, it } from "vitest";
import {
  extractPartialDiscreteFields,
  generateStanDataJson,
  generateStanInitsJson,
  generateStanModel,
} from "../src/codegen/stan";
import type { GraphNode } from "../src/core/types";
import {
  edge,
  mixedDagElements,
  mixtureElements,
  nestedMixtureElements,
  node,
} from "./helpers/marginalization-fixtures";

describe("marginalized Stan generation: iid plate latent", () => {
  const code = generateStanModel(mixtureElements());

  it("removes the latent from parameters and keeps no discrete warning", () => {
    expect(code).toMatch(
      /parameters \{\n {2}array\[2\] real<lower=0> sigma;\n {2}array\[2\] real mu;\n\}/,
    );
    expect(code).not.toContain("WARNING");
  });

  it("declares the dcat probability vector with the support size", () => {
    expect(code).toContain("vector[2] w;");
  });

  it("marginalizes inside the plate loop with prior and substituted factor terms", () => {
    expect(code).toContain("for (i in 1:N) {");
    expect(code).toContain("vector[2] z_lp;");
    expect(code).toContain("for (z_val in 1:2) {");
    expect(code).toContain("categorical_lpmf(z_val | w[1:2])");
    expect(code).toContain(
      "normal_lpdf(y[i] | mu[z_val], 1.0 / sqrt(1 / (sigma[z_val] * sigma[z_val])))",
    );
    expect(code).toContain("target += log_sum_exp(z_lp);");
  });

  it("emits no duplicate density statement for the consumed factor", () => {
    expect(code.match(/normal_lpdf\(y\[i\]/g)).toHaveLength(2);
    expect(code).not.toMatch(/y(\[i\])? ~ normal/);
  });

  it("recovers the latent in generated quantities via categorical_rng", () => {
    expect(code).toContain("array[N] int z;");
    expect(code).toContain("z[i] = categorical_rng(softmax(z_lp));");
  });

  it("drops the latent from generated inits", () => {
    const inits = generateStanInitsJson({ z: [1, 2, 1], mu: [0, 5] }, mixtureElements());
    expect(JSON.parse(inits)).toEqual({ mu: [0, 5] });
  });
});

describe("marginalized Stan generation: scalar DAG latents", () => {
  const code = generateStanModel(mixedDagElements());

  it("declares only the continuous parameters", () => {
    expect(code).toMatch(/parameters \{\n {2}real A;\n {2}real B;\n\}/);
  });

  it("sizes latent-indexed data arrays by the latent support", () => {
    expect(code).toContain("array[2] real muX;");
    expect(code).toContain("array[2] real deltaC;");
    expect(code).toContain("array[2] real deltaZ;");
    expect(code).toContain("vector[2] piX;");
  });

  it("eliminates X with an empty frontier and C against the frontier {Z}", () => {
    expect(code).toContain("// eliminate X");
    expect(code).toContain("normal_lpdf(A | muX[X_val], 1.0 / sqrt(tauA));");
    expect(code).toContain("array[2] real phi_C;");
    expect(code).toContain("phi_C[Z_val] = log_sum_exp(C_lp);");
    expect(code).toContain("+ phi_C[Z_val];");
  });

  it("maps dbern positions to zero-based values", () => {
    expect(code).toContain("int C_val = C_idx - 1;");
    expect(code).toContain("bernoulli_lpmf(C_val | pC)");
    expect(code).toContain("deltaC[C_val + 1]");
  });

  it("keeps the continuous-only deterministic node as a transformed parameter", () => {
    expect(code).toMatch(/transformed parameters \{\n {2}real pC;/);
  });

  it("keeps unconsumed density statements outside the elimination block", () => {
    expect(code).toContain("B ~ normal(A, 1.0 / sqrt(tauB));");
    expect(code.match(/normal_lpdf\(A \|/g)?.length).toBe(2);
  });

  it("recovers all latents jointly in generated quantities", () => {
    expect(code).toContain("int Z;");
    expect(code).toContain("int C;");
    expect(code).toContain("int X;");
    expect(code).toContain("vector[2 * 2 * 2] marg_joint_lp;");
    expect(code).toContain("marg_pick = categorical_rng(softmax(marg_joint_lp));");
    expect(code).toContain("Z = marg_conf_Z[marg_pick];");
    expect(code).toContain("C = marg_conf_C[marg_pick];");
    expect(code).toContain("X = marg_conf_X[marg_pick];");
  });
});

describe("marginalized Stan generation: inlined deterministic carriers", () => {
  it("substitutes the deterministic equation into the factor term", () => {
    const code = generateStanModel([
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
    ]);
    expect(code).toContain("normal_lpdf(y | (shift[Z_val]), 1.0 / sqrt(1))");
    expect(code).not.toContain("real m;");
    expect(code).toContain("array[2] real shift;");
  });
});

describe("marginalized Stan generation: review regressions", () => {
  it("emits a dependent discrete prior exactly once, in the parent's bucket", () => {
    const code = generateStanModel([
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
    ]);
    expect(code).toContain("array[2] vector[2] theta;");
    // once inside the elimination block, once in the generated-quantities recovery
    expect(code.match(/categorical_lpmf\(Y_val \| theta\[X_val, 1:2\]\)/g)).toHaveLength(2);
    expect(code.match(/categorical_lpmf\(X_val \| piX\[1:2\]\)/g)).toHaveLength(2);
    expect(code).toContain("phi_X[Y_val] = log_sum_exp(X_lp);");
    expect(code).not.toContain("int Y;\n  // WARNING");
  });

  it("falls back with the original error comment when a factor is untranslatable", () => {
    const code = generateStanModel([
      node({
        id: "plate_i",
        name: "ip",
        nodeType: "plate",
        loopVariable: "i",
        loopRange: "1:N",
      }),
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
    ]);
    expect(code).toContain("// WARNING: z ~ dbern is a discrete distribution.");
    expect(code).toContain("no translatable distribution");
    expect(code).toContain("'dgeom' has no Stan equivalent");
    expect(code).not.toContain("log_sum_exp");
  });

  it("skips joint recovery when the configuration count is too large", () => {
    const code = generateStanModel([
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
    ]);
    expect(code).toContain("// NOTE: eliminating");
    expect(code).toContain("// latent recovery skipped: joint enumeration of 40000 configurations");
    expect(code).not.toContain("marg_joint_lp");
  });
});

describe("marginalized Stan generation: unsupported latents keep the warning", () => {
  it("keeps the discrete warning plus the reason for a chain-structured latent", () => {
    const code = generateStanModel([
      node({
        id: "plate_t",
        name: "tp",
        nodeType: "plate",
        loopVariable: "t",
        loopRange: "1:T",
      }),
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
    ]);
    expect(code).toContain("// WARNING: z ~ dcat is a discrete distribution.");
    expect(code).toContain("(automatic marginalization not applied:");
    expect(code).toContain("chain structure");
    expect(code).toContain("y[t] ~ normal");
  });

  it("emits a poisson latent unchanged with the original warning", () => {
    const code = generateStanModel([
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
    ]);
    expect(code).toContain("// WARNING: z ~ dpois is a discrete distribution.");
    expect(code).not.toContain("automatic marginalization");
    expect(code).not.toContain("log_sum_exp");
  });
});

describe("marginalized Stan generation: dbin latents and dcat slices", () => {
  it("marginalizes a dbin latent over its zero-based support", () => {
    const code = generateStanModel([
      node({ id: "plate_i", name: "ip", nodeType: "plate", loopVariable: "i", loopRange: "1:N" }),
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
        param1: "mu[z[i] + 1]",
        param2: "1",
        indices: "i",
        parent: "plate_i",
      }),
      edge("phi", "z"),
      edge("z", "y"),
    ]);
    expect(code).toContain("vector[4] z_lp;");
    expect(code).toContain("int z_val = z_idx - 1;");
    expect(code).toContain("binomial_lpmf(z_val | 3, phi)");
    expect(code).toContain("normal_lpdf(y[i] | mu[z_val + 1], 1.0 / sqrt(1))");
    expect(code).toContain("array[4] real mu;");
    expect(code).toContain("z[i] = categorical_rng(softmax(z_lp)) - 1;");
    expect(code).not.toContain("WARNING");
  });

  it("declares a sliced dcat prior vector up to its upper bound", () => {
    const code = generateStanModel([
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
    ]);
    expect(code).toContain("vector[3] w;");
    expect(code).toContain("categorical_lpmf(Z_val | w[2:3])");
    expect(code).toContain("vector[2] Z_lp;");
  });
});

describe("marginalized Stan generation: partially observed discrete vectors", () => {
  const elements = () =>
    mixtureElements().map((el) =>
      el.type === "node" && el.id === "z" ? ({ ...el, nodeType: "observed" } as GraphNode) : el,
    );
  const data = { N: 4, w: [0.3, 0.7], y: [1.0, 2.0, -1.0, 3.0], z: [2, null, 1, null] };
  const code = generateStanModel(elements(), data);

  it("declares the observed values and indicator instead of the latent", () => {
    expect(code).toContain("array[N] int z_obs;");
    expect(code).toContain("array[N] int z_is_obs;");
    expect(code).not.toMatch(/array\[N\] int z;\n.*data/);
  });

  it("scores observed entries pointwise and marginalizes the missing ones", () => {
    expect(code).toContain("if (z_is_obs[i] == 1) {");
    expect(code).toContain("target += categorical_lpmf(z_obs[i] | w[1:2])");
    expect(code).toContain("normal_lpdf(y[i] | mu[z_obs[i]]");
    expect(code).toContain("} else {");
    expect(code).toContain("target += log_sum_exp(z_lp);");
  });

  it("recovers observed entries verbatim and missing entries from the posterior", () => {
    expect(code).toContain("array[N] int z;");
    expect(code).toContain("z[i] = z_obs[i];");
    expect(code).toContain("z[i] = categorical_rng(softmax(z_lp));");
  });

  it("without data the node stays fully observed", () => {
    const plain = generateStanModel(elements());
    expect(plain).not.toContain("z_is_obs");
    expect(plain).toContain("array[N] int z;");
  });

  it("generateStanDataJson renames the vector and adds the indicator", () => {
    const json = JSON.parse(
      generateStanDataJson(data, [], extractPartialDiscreteFields(elements(), data)),
    );
    expect(json.z_obs).toEqual([2, 1, 1, 1]);
    expect(json.z_is_obs).toEqual([1, 0, 1, 0]);
    expect(json.z).toBeUndefined();
  });
});

describe("marginalized Stan generation: nested plates", () => {
  const code = generateStanModel(nestedMixtureElements());

  it("opens one enumeration loop per plate and substitutes the multi-index reference", () => {
    expect(code).toContain("for (i in 1:N) {");
    expect(code).toContain("    for (j in 1:M) {");
    expect(code).toContain("// marginalize out z[i,j]");
    expect(code).toContain("normal_lpdf(y[i,j] | mu[z_val], 1.0 / sqrt(1))");
    expect(code).toContain("target += log_sum_exp(z_lp);");
    expect(code).not.toContain("WARNING");
  });

  it("recovers the latent as a matching multi-dimensional array", () => {
    expect(code).toContain("array[N, M] int z;");
    expect(code).toContain("z[i,j] = categorical_rng(softmax(z_lp));");
  });
});
