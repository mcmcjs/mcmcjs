import { describe, expect, it } from "vitest";
import {
  computeExcessKurtosis,
  computeHDI,
  computeMean,
  computeSkewness,
  computeStdev,
} from "../src/summary";

const arr = (xs: number[]) => Float64Array.from(xs);

describe("summary", () => {
  it("computes the mean", () => {
    expect(computeMean(arr([1, 2, 3, 4]))).toBe(2.5);
  });

  it("computes skewness", () => {
    expect(computeSkewness(arr([2, 4, 4, 4, 5, 5, 7, 9]))).toBeCloseTo(0.5371324568903997, 12);
  });

  it("computes excess kurtosis (subtracts 3)", () => {
    expect(computeExcessKurtosis(arr([2, 4, 4, 4, 5, 5, 7, 9]))).toBeCloseTo(
      -0.8706054687500004,
      12,
    );
  });

  it("returns 0 skewness/kurtosis for a constant array", () => {
    expect(computeSkewness(arr([5, 5, 5, 5]))).toBe(0);
    expect(computeExcessKurtosis(arr([5, 5, 5, 5]))).toBe(0);
  });

  it("returns NaN moments below the minimum sample size", () => {
    expect(computeSkewness(arr([1, 2]))).toBeNaN();
    expect(computeExcessKurtosis(arr([1, 2, 3]))).toBeNaN();
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
