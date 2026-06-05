import { describe, expect, it } from "vitest";
import { computeHDI, computeMean, computeStdev } from "./summary";

const arr = (xs: number[]) => Float64Array.from(xs);

describe("summary", () => {
  it("computes the mean", () => {
    expect(computeMean(arr([1, 2, 3, 4]))).toBe(2.5);
  });

  it("computes the sample standard deviation (ddof = 1)", () => {
    expect(computeStdev(arr([1, 2, 3, 4]))).toBeCloseTo(Math.sqrt(5 / 3), 12);
  });

  it("returns [c, c] for a constant array's HDI", () => {
    expect(computeHDI(arr([5, 5, 5, 5]), 0.9)).toEqual([5, 5]);
  });

  it("returns an HDI within the data range", () => {
    const [lo, hi] = computeHDI(arr([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]), 0.8);
    expect(lo).toBeGreaterThanOrEqual(1);
    expect(hi).toBeLessThanOrEqual(10);
    expect(hi).toBeGreaterThan(lo);
  });
});
