import type { Samples } from "@mcmcjs/core";
import { describe, expect, it } from "vitest";
import { chainIntervalsAllData, chainIntervalsData, violinData } from "../src/data";

function makeSamples(perVar: Record<string, number[][]>): Samples {
  const variables = Object.keys(perVar);
  const firstVar = perVar[variables[0] as string] as number[][];
  const nChains = firstVar.length;
  const nDraws = (firstVar[0] as number[]).length;
  const draws = new Map<string, Float64Array>();
  for (const v of variables) {
    const flat = new Float64Array(nChains * nDraws);
    (perVar[v] as number[][]).forEach((chain, c) => {
      flat.set(chain, c * nDraws);
    });
    draws.set(v, flat);
  }
  return { variables, nChains, nDraws, draws, sampleStats: new Map() };
}

// Fixture: variable x, 2 chains x 4 draws (quantile golden vectors are type-7 exact).
const fixture = makeSamples({
  x: [
    [1, 2, 3, 4],
    [2, 3, 4, 5],
  ],
});

describe("chainIntervalsData", () => {
  it("computes per-chain quantiles", () => {
    const d = chainIntervalsData(fixture, "x");
    expect(d.rows).toHaveLength(2);
    const c0 = d.rows[0];
    expect(c0?.label).toBe("chain 1");
    expect(c0?.q5).toBeCloseTo(1.15, 12);
    expect(c0?.q25).toBeCloseTo(1.75, 12);
    expect(c0?.q50).toBeCloseTo(2.5, 12);
    expect(c0?.q95).toBeCloseTo(3.85, 12);
    expect(d.rows[1]?.q5).toBeCloseTo(2.15, 12);
    expect(d.rows[1]?.q95).toBeCloseTo(4.85, 12);
  });
});

describe("chainIntervalsAllData", () => {
  it("computes pooled quantiles per variable", () => {
    const d = chainIntervalsAllData(fixture);
    expect(d.rows).toHaveLength(1);
    const r = d.rows[0];
    expect(r?.label).toBe("x");
    expect(r?.q5).toBeCloseTo(1.35, 12);
    expect(r?.q50).toBeCloseTo(3, 12);
    expect(r?.q95).toBeCloseTo(4.65, 12);
  });
});

describe("violinData", () => {
  it("emits a peak-normalized density band per chain", () => {
    const d = violinData(fixture, "x", { gridSize: 64 });
    expect(d.rows).toHaveLength(2);
    for (const r of d.rows) {
      expect(r.x).toHaveLength(64);
      expect(r.density).toHaveLength(64);
      expect(Math.max(...r.density)).toBeCloseTo(1, 12);
      expect(Math.min(...r.density)).toBeGreaterThanOrEqual(0);
    }
  });

  it("returns an all-zero density for a constant chain", () => {
    const flat = makeSamples({ x: [[5, 5, 5, 5]] });
    const d = violinData(flat, "x", { gridSize: 16 });
    expect(Math.max(...(d.rows[0]?.density ?? [1]))).toBe(0);
  });
});
