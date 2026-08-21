import { describe, expect, it } from "vitest";
import {
  countDivergences,
  DEFAULT_THRESHOLDS,
  diagnoseChains,
  isConverged,
  isDegenerate,
} from "../src/diagnose";
import { uniformChain } from "./test-helpers";

describe("countDivergences", () => {
  it("counts the entries greater than zero", () => {
    expect(countDivergences(new Float64Array([0, 1, 0, 1, 1]))).toBe(3);
    expect(countDivergences(new Float64Array([0, 0, 0]))).toBe(0);
  });
});

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

describe("isDegenerate", () => {
  const constant = (n: number, value = 1) => Float64Array.from({ length: n }, () => value);

  it("is false for a lone chain that mixes, whose R-hat is undefined for want of a second", () => {
    const d = diagnoseChains([uniformChain(256, 1)]);
    expect(Number.isFinite(d.rhat)).toBe(false);
    expect(d.varies).toBe(true);
    expect(isDegenerate(d)).toBe(false);
  });

  it("is true when a chain never moves, however many chains there are", () => {
    expect(isDegenerate(diagnoseChains([constant(64)]))).toBe(true);
    expect(isDegenerate(diagnoseChains([constant(64), constant(64)]))).toBe(true);
  });

  it("is true when only one of several chains stood still", () => {
    // The pooled draws vary, so a std test would miss this; R-hat is undefined
    // all the same, and the variable carries no evidence either way.
    const d = diagnoseChains([constant(64, 2), uniformChain(64, 3)]);
    expect(d.std).toBeGreaterThan(0);
    expect(isDegenerate(d)).toBe(true);
  });

  it("is false for unusable draws, which are corrupt rather than still", () => {
    const nan = Float64Array.from({ length: 8 }, () => Number.NaN);
    const d = diagnoseChains([nan, nan]);
    expect(d.varies).toBe(false);
    expect(isDegenerate(d)).toBe(false);
  });
});
