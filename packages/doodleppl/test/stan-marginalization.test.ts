import { describe, expect, it } from "vitest";
import { generateStanInitsJson, generateStanModel } from "../src/codegen/stan";
import { edge, mixedDagElements, mixtureElements, node } from "./helpers/marginalization-fixtures";

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
