import { describe, it } from "vitest";
import { generateStanModel } from "../src/codegen/stan";
import { edge, node } from "./helpers/marginalization-fixtures";

describe("claim repro: latentIndexedDataDims", () => {
  it("scenario A: mixed latent + range subscript piW[z, 1:2]", () => {
    const elements = [
      node({ id: "z", name: "z", distribution: "dcat", param1: "piZ[1:2]" }),
      node({ id: "w", name: "w", distribution: "dcat", param1: "piW[z, 1:2]" }),
      node({
        id: "y",
        name: "y",
        nodeType: "observed",
        distribution: "dnorm",
        param1: "muW[w]",
        param2: "1",
      }),
      edge("z", "w"),
      edge("w", "y"),
    ];
    console.log("=== SCENARIO A ===");
    console.log(generateStanModel(elements));
  });

  it("scenario B: affine index on 1-based dcat arr[z + 1]", () => {
    const elements = [
      node({ id: "z", name: "z", distribution: "dcat", param1: "piZ[1:3]" }),
      node({
        id: "y",
        name: "y",
        nodeType: "observed",
        distribution: "dnorm",
        param1: "arr[z + 1]",
        param2: "1",
      }),
      edge("z", "y"),
    ];
    console.log("=== SCENARIO B ===");
    console.log(generateStanModel(elements));
  });
});
