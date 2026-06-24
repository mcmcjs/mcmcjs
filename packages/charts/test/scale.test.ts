import { describe, expect, it } from "vitest";
import { linearScale, niceDomain } from "../src/scale";

describe("linearScale", () => {
  it("maps and inverts linearly", () => {
    const s = linearScale([0, 10], [0, 100]);
    expect(s.map(0)).toBe(0);
    expect(s.map(5)).toBe(50);
    expect(s.map(10)).toBe(100);
    expect(s.invert(50)).toBe(5);
  });

  it("supports an inverted range", () => {
    const s = linearScale([0, 1], [9, 0]);
    expect(s.map(0)).toBe(9);
    expect(s.map(1)).toBe(0);
  });

  it("maps a zero-width domain to the range start", () => {
    const s = linearScale([5, 5], [0, 100]);
    expect(s.map(5)).toBe(0);
    expect(s.map(42)).toBe(0);
  });
});

describe("niceDomain", () => {
  it("pads a range by a fraction", () => {
    expect(niceDomain(0, 10, 0.1)).toEqual([-1, 11]);
  });

  it("expands a zero-width range", () => {
    expect(niceDomain(3, 3)).toEqual([2, 4]);
  });

  it("falls back to [0, 1] for non-finite input", () => {
    expect(niceDomain(Number.NaN, 1)).toEqual([0, 1]);
  });
});
