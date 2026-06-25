import { describe, expect, it } from "vitest";
import { pearson, spearman } from "../src/correlation";

const X = [1, 2, 3, 4, 5, 6, 7, 8];
const Y = [2, 1, 4, 3, 6, 5, 8, 7];
const Xexp = [1, 4, 9, 16, 25, 36, 49, 64];

describe("pearson", () => {
  it("matches the swap-adjacent golden vector (0.9047619047)", () => {
    expect(pearson(X, Y)).toBeCloseTo(0.9047619047619048, 12);
  });

  it("matches the monotone-nonlinear golden vector", () => {
    expect(pearson(X, Xexp)).toBeCloseTo(0.9761870601, 8);
  });

  it("returns 0 for a constant series (zero denominator)", () => {
    expect(pearson([3, 3, 3, 3], X)).toBe(0);
  });

  it("returns 0 when fewer than two pairs", () => {
    expect(pearson([1], [1])).toBe(0);
    expect(pearson([], [])).toBe(0);
  });
});

describe("spearman", () => {
  it("is exactly 1 for a strictly monotone relationship (unlike pearson)", () => {
    expect(spearman(X, Xexp)).toBe(1);
    expect(pearson(X, Xexp)).toBeLessThan(1);
  });

  it("equals pearson when ranks match the values", () => {
    expect(spearman(X, Y)).toBe(pearson(X, Y));
  });

  it("returns 0 when fewer than two pairs", () => {
    expect(spearman([1], [1])).toBe(0);
  });
});
