import type { LedgerEntry } from "@mcmcjs/core";
import { describe, expect, it } from "vitest";
import { defaultExportName } from "../src/export";

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
