import { describe, expect, it } from "vitest";
import { extent, fmtNum } from "../src/format";

describe("fmtNum", () => {
  it("trims to at most three decimals", () => {
    expect(fmtNum(1.23456)).toBe("1.235");
    expect(fmtNum(2)).toBe("2");
  });

  it("uses exponential notation for extreme magnitudes", () => {
    expect(fmtNum(123456)).toBe("1.2e+5");
    expect(fmtNum(0.0001)).toBe("1.0e-4");
  });

  it("returns n/a for non-finite values", () => {
    expect(fmtNum(Number.NaN)).toBe("n/a");
    expect(fmtNum(Number.POSITIVE_INFINITY)).toBe("n/a");
  });
});

describe("extent", () => {
  it("returns [min, max] ignoring non-finite values", () => {
    expect(extent([3, 1, Number.NaN, 2, Number.POSITIVE_INFINITY])).toEqual([1, 3]);
  });

  it("returns [0, 1] when there are no finite values", () => {
    expect(extent([])).toEqual([0, 1]);
    expect(extent([Number.NaN])).toEqual([0, 1]);
  });
});
