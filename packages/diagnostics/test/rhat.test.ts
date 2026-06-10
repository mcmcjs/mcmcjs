import { describe, expect, it } from "vitest";
import { computeRhat } from "../src/rhat";
import { uniformChain } from "./test-helpers";

describe("computeRhat", () => {
  it("is near 1 for well-mixed chains from the same distribution", () => {
    const chains = [
      uniformChain(500, 1),
      uniformChain(500, 2),
      uniformChain(500, 3),
      uniformChain(500, 4),
    ];
    const r = computeRhat(chains, "rank");
    expect(Number.isFinite(r)).toBe(true);
    expect(r).toBeGreaterThan(0.95);
    expect(r).toBeLessThan(1.05);
  });

  it("is large for chains exploring different locations", () => {
    const chains = [
      uniformChain(500, 1),
      uniformChain(500, 2),
      uniformChain(500, 3, 10),
      uniformChain(500, 4, 10),
    ];
    expect(computeRhat(chains, "rank")).toBeGreaterThan(1.5);
  });

  it("returns NaN for fewer than 2 chains", () => {
    expect(Number.isNaN(computeRhat([uniformChain(500, 1)]))).toBe(true);
  });

  it("returns NaN for constant chains", () => {
    const c = Float64Array.from({ length: 100 }, () => 3);
    expect(Number.isNaN(computeRhat([c, c]))).toBe(true);
  });
});
