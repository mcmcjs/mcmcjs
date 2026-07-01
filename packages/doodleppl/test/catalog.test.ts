import { describe, expect, it } from "vitest";
import { BUGS_FUNCTIONS, DISTRIBUTIONS, getDistribution } from "../src/core/catalog";

describe("DISTRIBUTIONS", () => {
  it("carries the 26 BUGS distributions with unique names", () => {
    expect(DISTRIBUTIONS).toHaveLength(26);
    expect(new Set(DISTRIBUTIONS.map((d) => d.name)).size).toBe(26);
  });

  it("keeps paramNames consistent with paramCount", () => {
    for (const d of DISTRIBUTIONS) {
      expect(d.paramNames).toHaveLength(d.paramCount);
    }
  });

  it("looks up a distribution by name", () => {
    expect(getDistribution("dnorm")).toMatchObject({
      paramCount: 2,
      paramNames: ["mean", "precision"],
    });
    expect(getDistribution("dflat")?.paramCount).toBe(0);
    expect(getDistribution("dnormal")).toBeUndefined();
  });
});

describe("BUGS_FUNCTIONS", () => {
  it("contains the link and helper functions used in equations", () => {
    for (const fn of ["logit", "ilogit", "sqrt", "inprod", "step"]) {
      expect(BUGS_FUNCTIONS.has(fn)).toBe(true);
    }
    expect(BUGS_FUNCTIONS.has("dnorm")).toBe(false);
  });
});
