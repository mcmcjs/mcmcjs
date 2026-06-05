import { describe, expect, it } from "vitest";
import { DEFAULT_THRESHOLDS, diagnoseChains, isConverged } from "./diagnose";
import { uniformChain } from "./test-helpers";

describe("diagnoseChains", () => {
  it("reports finite diagnostics and converges for well-mixed chains", () => {
    const chains = [
      uniformChain(2000, 1),
      uniformChain(2000, 2),
      uniformChain(2000, 3),
      uniformChain(2000, 4),
    ];
    const d = diagnoseChains(chains);
    expect(Number.isFinite(d.mean)).toBe(true);
    expect(Number.isFinite(d.rhat)).toBe(true);
    expect(d.essBulk).toBeGreaterThan(DEFAULT_THRESHOLDS.essMin);
    expect(d.hdi[0]).toBeLessThan(d.hdi[1]);
    expect(isConverged(d)).toBe(true);
  });

  it("flags non-convergence for chains in different locations", () => {
    const d = diagnoseChains([
      uniformChain(2000, 1),
      uniformChain(2000, 2),
      uniformChain(2000, 3, 10),
      uniformChain(2000, 4, 10),
    ]);
    expect(d.rhat).toBeGreaterThan(1.01);
    expect(isConverged(d)).toBe(false);
  });
});
