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
