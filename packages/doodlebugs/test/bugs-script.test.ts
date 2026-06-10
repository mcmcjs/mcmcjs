import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { generateStandaloneScript } from "../src/bugs-script";
import { generateBugsModel } from "../src/codegen";
import { getElements, parseModelData, parseUnifiedModel } from "../src/model";

const FIXTURES = fileURLToPath(new URL("./fixtures", import.meta.url));

// Settings used when the reference run_model.jl fixtures were captured.
const SETTINGS = { n_samples: 1000, n_adapts: 1000, n_chains: 4, seed: 42 };

const examples = readdirSync(join(FIXTURES, "bugs")).sort();

// Byte-for-byte equivalence with the editor's BUGS codegen and standalone-script
// generator, captured from the original implementation over the example graphs.
// kidney and mice carry censoring, exercising the @bugs_primitive branch.
describe("bugs codegen and script match the editor reference output", () => {
  for (const name of examples) {
    it(name, () => {
      const model = parseUnifiedModel(
        readFileSync(join(FIXTURES, "examples", `${name}.json`), "utf8"),
      );
      const elements = getElements(model);
      const { data, inits } = parseModelData(model);
      const ref = (file: string) => readFileSync(join(FIXTURES, "bugs", name, file), "utf8");

      const modelCode = generateBugsModel(elements);
      expect(modelCode).toBe(ref("model.bugs"));
      expect(generateStandaloneScript({ modelCode, data, inits, settings: SETTINGS })).toBe(
        ref("run_model.jl"),
      );
    });
  }
});

describe("generateStandaloneScript", () => {
  it("renders missing values, vectors, and matrices as Julia literals", () => {
    const script = generateStandaloneScript({
      modelCode: "model {\n}",
      data: {
        y: [1, null, 3],
        m: [
          [1, 2],
          [3, 4],
        ],
        "tau.c": 1,
      },
      inits: {},
      settings: { n_samples: 10, n_adapts: 10, n_chains: 1, seed: null },
    });
    expect(script).toContain("y = [1, missing, 3]");
    expect(script).toContain("tau_c = 1");
    expect(script).toContain("inits = ()");
    expect(script).toContain("seed = nothing");
  });

  it("registers the censored primitive only when the model uses censoring", () => {
    const censored = generateStandaloneScript({
      modelCode: "model {\n  t ~ dweib(r, mu)C(c,)\n}",
      data: {},
      inits: {},
      settings: SETTINGS,
    });
    expect(censored).toContain("using Distributions: censored");
    expect(censored).toContain("JuliaBUGS.@bugs_primitive censored");

    const plain = generateStandaloneScript({
      modelCode: "model {\n  mu ~ dnorm(0, 1)\n}",
      data: {},
      inits: {},
      settings: SETTINGS,
    });
    expect(plain).not.toContain("censored");
  });
});
