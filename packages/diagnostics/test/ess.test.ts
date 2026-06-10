import { describe, expect, it } from "vitest";
import { computeEssBulk, computeEssTail } from "../src/ess";
import { ar1Chain, uniformChain } from "./test-helpers";

describe("ESS", () => {
  it("returns NaN for fewer than 2 chains", () => {
    expect(Number.isNaN(computeEssBulk([uniformChain(500, 1)]))).toBe(true);
  });

  it("is positive and finite for well-mixed chains", () => {
    const ess = computeEssBulk([uniformChain(1000, 1), uniformChain(1000, 2)]);
    expect(Number.isFinite(ess)).toBe(true);
    expect(ess).toBeGreaterThan(0);
  });

  it("is lower for autocorrelated chains than for independent chains", () => {
    const independent = computeEssBulk([uniformChain(1000, 1), uniformChain(1000, 2)]);
    const correlated = computeEssBulk([ar1Chain(1000, 1, 0.8), ar1Chain(1000, 2, 0.8)]);
    expect(correlated).toBeLessThan(independent);
  });

  it("computes a finite tail-ESS", () => {
    expect(Number.isFinite(computeEssTail([uniformChain(1000, 1), uniformChain(1000, 2)]))).toBe(
      true,
    );
  });
});
