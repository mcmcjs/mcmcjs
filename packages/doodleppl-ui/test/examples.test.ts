import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { GraphEdge, GraphNode } from "@mcmcjs/doodleppl";
import {
  buildTopologicalOrder,
  generateBugsModel,
  getElements,
  parseModelData,
  parseUnifiedModel,
  validateGraph,
} from "@mcmcjs/doodleppl";
import { generateStanModel } from "@mcmcjs/doodleppl/stan";
import { describe, expect, it } from "vitest";

const EXAMPLES = fileURLToPath(new URL("../src/widget/config/examples", import.meta.url));

describe("bundled examples", () => {
  for (const file of readdirSync(EXAMPLES).sort()) {
    it(`${file} parses, is acyclic, and generates code`, () => {
      const model = parseUnifiedModel(readFileSync(join(EXAMPLES, file), "utf8"));
      const elements = getElements(model);
      const nodes = elements.filter((el): el is GraphNode => el.type === "node");
      const edges = elements.filter((el): el is GraphEdge => el.type === "edge");
      expect(buildTopologicalOrder(nodes, edges)).toHaveLength(nodes.length);
      expect(parseModelData(model).data).toBeTruthy();
      expect(generateBugsModel(elements)).toContain("model {");
      expect(generateStanModel(elements)).toContain("model {");
    });
  }

  it("mixture example marginalizes its discrete latent in the Stan output", () => {
    const model = parseUnifiedModel(readFileSync(join(EXAMPLES, "mixture.json"), "utf8"));
    const elements = getElements(model);
    const { data } = parseModelData(model);
    expect(validateGraph(elements, data)).toEqual([]);
    const code = generateStanModel(elements);
    expect(code).toContain("target += log_sum_exp(z_lp);");
    expect(code).toContain("z[i] = categorical_rng(softmax(z_lp));");
    expect(code).not.toContain("WARNING");
  });

  it("mixed DAG example eliminates all three discrete latents in the Stan output", () => {
    const model = parseUnifiedModel(readFileSync(join(EXAMPLES, "mixed-dag.json"), "utf8"));
    const elements = getElements(model);
    const { data } = parseModelData(model);
    expect(validateGraph(elements, data)).toEqual([]);
    const code = generateStanModel(elements);
    expect(code).toContain("// eliminate X");
    expect(code).toContain("// eliminate C");
    expect(code).toContain("// eliminate Z");
    expect(code).toContain("marg_pick = categorical_rng(softmax(marg_joint_lp));");
    expect(code).not.toContain("WARNING");
  });
});
