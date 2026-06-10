import { describe, expect, it } from "vitest";
import { computeMCSEMultiChain } from "../src/mcse";
import { uniformChain } from "./test-helpers";

describe("computeMCSEMultiChain", () => {
  it("is positive and finite for well-mixed chains", () => {
    const m = computeMCSEMultiChain([uniformChain(1000, 1), uniformChain(1000, 2)]);
    expect(Number.isFinite(m)).toBe(true);
    expect(m).toBeGreaterThan(0);
  });

  it("scales linearly with the data scale", () => {
    const base = [uniformChain(1000, 1), uniformChain(1000, 2)];
    const scaled = base.map((c) => Float64Array.from(c, (v) => 2 * v));
    expect(computeMCSEMultiChain(scaled)).toBeCloseTo(2 * computeMCSEMultiChain(base), 6);
  });
});
