import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  extractCensoredFields,
  generateStanDataJson,
  generateStanInitsJson,
  generateStanModel,
  generateStanStandaloneScript,
} from "../src/codegen/stan";
import { getElements, parseModelData, parseUnifiedModel } from "../src/core/model";
import type { GraphElement } from "../src/core/types";

const FIXTURES = fileURLToPath(new URL("./fixtures", import.meta.url));

// Settings used when the reference run_stan_model.py fixtures were captured.
const SETTINGS = { n_samples: 1000, n_adapts: 1000, n_chains: 4, seed: 42 };

const examples = readdirSync(join(FIXTURES, "stan")).sort();

// Byte-for-byte equivalence with the editor's generator, captured from the
// original implementation over the 12 bundled example graphs.
describe("stan generator matches the editor reference output", () => {
  for (const name of examples) {
    it(name, () => {
      const model = parseUnifiedModel(
        readFileSync(join(FIXTURES, "examples", `${name}.json`), "utf8"),
      );
      const elements = getElements(model);
      const { data, inits } = parseModelData(model);
      const ref = (file: string) => readFileSync(join(FIXTURES, "stan", name, file), "utf8");

      const censoredFields = extractCensoredFields(elements);
      const modelCode = generateStanModel(elements);

      expect(modelCode).toBe(ref("model.stan"));
      expect(generateStanDataJson(data, censoredFields)).toBe(ref("data.json"));
      expect(generateStanInitsJson(inits, elements)).toBe(ref("inits.json"));
      expect(
        generateStanStandaloneScript({
          modelCode,
          data,
          inits,
          elements,
          censoredFields,
          settings: SETTINGS,
        }),
      ).toBe(ref("run_stan_model.py"));
    });
  }
});

describe("generateStanModel", () => {
  const node = (n: Partial<GraphElement> & { id: string }): GraphElement =>
    ({ type: "node", ...n }) as GraphElement;

  it("returns an empty-model comment for a graph with no nodes", () => {
    expect(generateStanModel([])).toBe("// Empty model\n");
  });

  it("converts precision to scale for dnorm and bounds positive-support parameters", () => {
    const code = generateStanModel([
      node({
        id: "tau",
        name: "tau",
        nodeType: "stochastic",
        distribution: "dgamma",
        param1: "0.001",
        param2: "0.001",
      }),
      node({
        id: "mu",
        name: "mu",
        nodeType: "stochastic",
        distribution: "dnorm",
        param1: "0",
        param2: "tau",
      }),
    ]);
    expect(code).toContain("real<lower=0> tau;");
    expect(code).toContain("mu ~ normal(0, 1.0 / sqrt(tau));");
  });

  it("emits a comment instead of a sampling statement for an unmapped distribution", () => {
    const code = generateStanModel([
      node({
        id: "g",
        name: "g",
        nodeType: "stochastic",
        distribution: "dgev",
        param1: "0",
        param2: "1",
        param3: "0",
      }),
    ]);
    expect(code).toContain("// ERROR: 'dgev' has no Stan equivalent");
  });
});

// Stan runs a block's assignments in order, so a plate loop that reads a
// top-level deterministic node has to come after that node's assignment.
describe("a top-level deterministic node read inside a plate is assigned before the loop", () => {
  const node = (n: Partial<GraphElement> & { id: string }): GraphElement =>
    ({ type: "node", name: n.id, ...n }) as GraphElement;
  const inPlate = (n: Partial<GraphElement> & { id: string }) =>
    node({ parent: "plate_i", indices: "i", ...n });
  const edge = (source: string, target: string): GraphElement =>
    ({ id: `${source}_${target}`, type: "edge", source, target }) as GraphElement;
  // Listed first and with no edges of its own, which is what used to sort the loop first.
  const plate = node({ id: "plate_i", nodeType: "plate", loopVariable: "i", loopRange: "1:N" });

  const block = (code: string, name: string): string => {
    const start = code.indexOf(`${name} {`);
    expect(start, `${name} block`).toBeGreaterThanOrEqual(0);
    return code.slice(start, code.indexOf("\n}", start));
  };
  const expectAssignedBeforeLoop = (text: string, name: string) => {
    const assignment = text.indexOf(`${name} = `);
    expect(assignment, `${name} is assigned`).toBeGreaterThanOrEqual(0);
    expect(assignment).toBeLessThan(text.indexOf("for (i in 1:N)"));
  };

  it("in transformed parameters", () => {
    const code = generateStanModel([
      plate,
      node({ id: "tau", nodeType: "stochastic", distribution: "dgamma", param1: "1", param2: "1" }),
      node({ id: "sigma", nodeType: "deterministic", equation: "1 / sqrt(tau)" }),
      inPlate({ id: "z", nodeType: "stochastic", distribution: "dnorm", param1: "0", param2: "1" }),
      inPlate({ id: "b", nodeType: "deterministic", equation: "sigma * z[i]" }),
      inPlate({
        id: "y",
        nodeType: "observed",
        observed: true,
        distribution: "dnorm",
        param1: "b[i]",
        param2: "1",
      }),
      edge("tau", "sigma"),
      edge("sigma", "b"),
      edge("z", "b"),
      edge("b", "y"),
    ]);
    expectAssignedBeforeLoop(block(code, "transformed parameters"), "sigma");
  });

  it("in transformed data", () => {
    const code = generateStanModel([
      plate,
      node({ id: "c", nodeType: "constant" }),
      node({ id: "scale", nodeType: "deterministic", equation: "2 * c" }),
      inPlate({ id: "x", nodeType: "constant" }),
      inPlate({ id: "w", nodeType: "deterministic", equation: "scale * x[i]" }),
      node({
        id: "theta",
        nodeType: "stochastic",
        distribution: "dnorm",
        param1: "0",
        param2: "1",
      }),
      inPlate({
        id: "y",
        nodeType: "observed",
        observed: true,
        distribution: "dnorm",
        param1: "theta * w[i]",
        param2: "1",
      }),
      edge("c", "scale"),
      edge("scale", "w"),
      edge("x", "w"),
      edge("w", "y"),
      edge("theta", "y"),
    ]);
    expectAssignedBeforeLoop(block(code, "transformed data"), "scale");
  });

  it("in generated quantities", () => {
    const code = generateStanModel([
      plate,
      node({ id: "tau", nodeType: "stochastic", distribution: "dgamma", param1: "1", param2: "1" }),
      node({ id: "sigma", nodeType: "deterministic", equation: "1 / sqrt(tau)" }),
      inPlate({ id: "z", nodeType: "stochastic", distribution: "dnorm", param1: "0", param2: "1" }),
      inPlate({ id: "pred", nodeType: "deterministic", equation: "sigma * z[i]" }),
      inPlate({
        id: "y",
        nodeType: "observed",
        observed: true,
        distribution: "dnorm",
        param1: "z[i]",
        param2: "1",
      }),
      edge("tau", "sigma"),
      edge("sigma", "pred"),
      edge("z", "pred"),
      edge("z", "y"),
    ]);
    expectAssignedBeforeLoop(block(code, "generated quantities"), "sigma");
  });

  it("when it is the mean of data the plate holds", () => {
    const code = generateStanModel([
      plate,
      inPlate({ id: "x", nodeType: "constant" }),
      node({ id: "xbar", nodeType: "deterministic", equation: "mean(x[1:N])" }),
      inPlate({ id: "xc", nodeType: "deterministic", equation: "x[i] - xbar" }),
      node({
        id: "alpha",
        nodeType: "stochastic",
        distribution: "dnorm",
        param1: "0",
        param2: "1",
      }),
      inPlate({
        id: "y",
        nodeType: "observed",
        observed: true,
        distribution: "dnorm",
        param1: "alpha + xc[i]",
        param2: "1",
      }),
      edge("x", "xbar"),
      edge("x", "xc"),
      edge("xbar", "xc"),
      edge("xc", "y"),
      edge("alpha", "y"),
    ]);
    expectAssignedBeforeLoop(block(code, "transformed data"), "xbar");
  });

  it("when it is the mean of parameters the plate holds", () => {
    const code = generateStanModel([
      plate,
      inPlate({ id: "b", nodeType: "stochastic", distribution: "dnorm", param1: "0", param2: "1" }),
      node({ id: "bbar", nodeType: "deterministic", equation: "mean(b[1:N])" }),
      inPlate({ id: "bc", nodeType: "deterministic", equation: "b[i] - bbar" }),
      inPlate({
        id: "y",
        nodeType: "observed",
        observed: true,
        distribution: "dnorm",
        param1: "bc[i]",
        param2: "1",
      }),
      edge("b", "bbar"),
      edge("b", "bc"),
      edge("bbar", "bc"),
      edge("bc", "y"),
    ]);
    expectAssignedBeforeLoop(block(code, "transformed parameters"), "bbar");
  });

  it("while a mean of the loop's values that only the likelihood reads comes after it", () => {
    const code = generateStanModel([
      plate,
      node({ id: "tau", nodeType: "stochastic", distribution: "dgamma", param1: "1", param2: "1" }),
      node({ id: "sigma", nodeType: "deterministic", equation: "1 / sqrt(tau)" }),
      inPlate({ id: "z", nodeType: "stochastic", distribution: "dnorm", param1: "0", param2: "1" }),
      inPlate({ id: "m", nodeType: "deterministic", equation: "sigma * z[i]" }),
      node({ id: "mbar", nodeType: "deterministic", equation: "mean(m[1:N])" }),
      inPlate({
        id: "y",
        nodeType: "observed",
        observed: true,
        distribution: "dnorm",
        param1: "m[i] - mbar",
        param2: "1",
      }),
      edge("tau", "sigma"),
      edge("sigma", "m"),
      edge("z", "m"),
      edge("m", "mbar"),
      edge("m", "y"),
      edge("mbar", "y"),
    ]);
    const text = block(code, "transformed parameters");
    expectAssignedBeforeLoop(text, "sigma");
    expect(text.indexOf("mbar = ")).toBeGreaterThan(text.indexOf("for (i in 1:N)"));
  });
});
