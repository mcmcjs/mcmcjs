import type { Samples } from "@mcmcjs/core";
import { describe, expect, it } from "vitest";
import { cumulativeMeanData, ecdfData, runningRhatData } from "../src/data";

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

// Golden fixture: 2 chains x 8 draws (vectors verified against MCMCVisualizer).
const fixture = makeSamples({
  x: [
    [0, 1, 2, 3, 4, 5, 6, 7],
    [1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5],
  ],
});

describe("ecdfData", () => {
  it("emits sorted draws with cumulative probabilities per chain", () => {
    const d = ecdfData(fixture, "x");
    expect(d.series).toHaveLength(2);
    expect(d.series[0]?.x).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(d.series[0]?.y).toEqual([0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875, 1]);
    expect(d.series[1]?.x).toEqual([1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5]);
  });
});

describe("cumulativeMeanData", () => {
  it("computes the running mean per chain", () => {
    const d = cumulativeMeanData(fixture, "x");
    expect(d.iterations).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(d.chains[0]).toEqual([0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5]);
    expect(d.chains[1]).toEqual([1, 1.25, 1.5, 1.75, 2, 2.25, 2.5, 2.75]);
  });
});

describe("runningRhatData", () => {
  it("matches the reference basic R-hat at each prefix", () => {
    const d = runningRhatData(fixture, "x");
    expect(d.iterations).toEqual([6, 7, 8]);
    expect(d.rhat[0]).toBeCloseTo(1.9235384061671346, 10);
    expect(d.rhat[1]).toBeCloseTo(2.4765567494675613, 10);
    expect(d.rhat[2]).toBeCloseTo(2.0322401432901573, 10);
  });

  it("returns empty arrays for a single chain", () => {
    const single = makeSamples({ x: [[0, 1, 2, 3, 4, 5, 6, 7]] });
    expect(runningRhatData(single, "x").iterations).toEqual([]);
  });

  it("returns empty arrays when chains have fewer than 6 draws", () => {
    const short = makeSamples({
      x: [
        [0, 1, 2, 3, 4],
        [1, 2, 3, 4, 5],
      ],
    });
    expect(runningRhatData(short, "x").rhat).toEqual([]);
  });
});
