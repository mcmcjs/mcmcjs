import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { chiSquarePValue, sbcUniformity } from "../src/sbc";

interface Fixture {
  chi2_sf: { statistic: number; dof: number; p: number }[];
  n_possible: number;
  uniform: { ranks: number[]; bins: number; counts: number[]; statistic: number; p: number };
  skewed: { ranks: number[]; bins: number; counts: number[]; statistic: number; p: number };
}

const fixture = JSON.parse(
  readFileSync(join(__dirname, "fixtures", "sbc-reference.json"), "utf8"),
) as Fixture;

describe("chiSquarePValue against scipy", () => {
  for (const c of fixture.chi2_sf) {
    it(`matches chi2.sf(${c.statistic}, ${c.dof})`, () => {
      const p = chiSquarePValue(c.statistic, c.dof);
      expect(Math.abs(p - c.p)).toBeLessThan(1e-12 * Math.max(1, Math.abs(c.p)) + 1e-15);
    });
  }

  it("handles the boundaries", () => {
    expect(chiSquarePValue(0, 5)).toBe(1);
    expect(chiSquarePValue(1e6, 5)).toBeCloseTo(0, 12);
    expect(Number.isNaN(chiSquarePValue(1, 0))).toBe(true);
  });
});

describe("sbcUniformity", () => {
  it("matches the scipy-computed statistic on uniform ranks", () => {
    const { ranks, bins, counts, statistic, p } = fixture.uniform;
    const result = sbcUniformity(ranks, fixture.n_possible, { bins });
    expect(result.counts).toEqual(counts);
    expect(result.statistic).toBeCloseTo(statistic, 10);
    expect(result.pValue).toBeCloseTo(p, 10);
    expect(result.pValue).toBeGreaterThan(0.05);
  });

  it("flags severely skewed ranks", () => {
    const { ranks, bins, statistic, p } = fixture.skewed;
    const result = sbcUniformity(ranks, fixture.n_possible, { bins });
    expect(result.statistic).toBeCloseTo(statistic, 10);
    expect(result.pValue).toBeCloseTo(p, 20);
    expect(result.pValue).toBeLessThan(1e-10);
  });

  it("sizes bins by simulation count and honors uneven widths", () => {
    // 30 sims -> 6 bins by default; 7 possible ranks over 6 bins leaves one
    // bin twice as wide, with a proportional expectation.
    const ranks = Array.from({ length: 30 }, (_, i) => i % 7);
    const result = sbcUniformity(ranks, 7);
    expect(result.bins).toBe(6);
    expect(result.expected.reduce((a, b) => a + b, 0)).toBeCloseTo(30, 10);
    expect(Math.max(...result.expected)).toBeCloseTo(2 * (30 / 7), 10);
  });

  it("rejects out-of-range and fractional ranks", () => {
    expect(() => sbcUniformity([0, 5], 5)).toThrow(/outside/);
    expect(() => sbcUniformity([0.5], 5)).toThrow(/outside/);
    expect(() => sbcUniformity([], 5)).toThrow(/at least one/);
  });
});
