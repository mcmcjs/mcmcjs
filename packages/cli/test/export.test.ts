import type { LedgerEntry } from "@mcmcjs/core";
import { describe, expect, it } from "vitest";
import { defaultExportName, specRelativePath } from "../src/export";

const entry = {
  model_path: "analysis/eight_schools.jl",
} as LedgerEntry;

describe("defaultExportName", () => {
  it("derives names from the model stem", () => {
    expect(defaultExportName("samples", entry)).toBe("eight_schools.samples.json");
    expect(defaultExportName("spec", entry)).toBe("eight_schools.toml");
    expect(defaultExportName("record", entry)).toBe("eight_schools.run.json");
  });
});

describe("specRelativePath", () => {
  it("emits ./-style sibling paths", () => {
    expect(specRelativePath("/p", "/p/model.jl")).toBe("./model.jl");
  });

  it("descends and ascends with / separators", () => {
    expect(specRelativePath("/p", "/p/analysis/model.jl")).toBe("./analysis/model.jl");
    expect(specRelativePath("/p/out", "/p/model.jl")).toBe("../model.jl");
  });
});
