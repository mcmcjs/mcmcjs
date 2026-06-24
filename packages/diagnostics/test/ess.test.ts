import { describe, expect, it } from "vitest";
import { autocorr, computeEssBulk, computeEssTail } from "../src/ess";
import { ar1Chain, uniformChain } from "./test-helpers";

describe("autocorr", () => {
  it("starts at 1.0, respects maxLag, and decays for an AR(1) chain", () => {
    const acf = autocorr(ar1Chain(2000, 1, 0.6), 30);
    expect(acf).toHaveLength(31); // lags 0..30
    expect(acf[0]).toBeCloseTo(1, 6);
    expect(acf[1] as number).toBeGreaterThan(0.3); // ~phi
    expect(Math.abs(acf[10] as number)).toBeLessThan(Math.abs(acf[1] as number));
  });

  it("returns an empty array for a too-short chain", () => {
    expect(autocorr(new Float64Array([1, 2, 3]))).toEqual([]);
  });
});

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
