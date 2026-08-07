import type { Samples } from "@mcmcjs/core";
import { describe, expect, it } from "vitest";
import { ppcDensityData, ppcStatData } from "../src/data";
import { renderPpcDensitySVG, renderPpcStatSVG } from "../src/svg";
import { renderPpcDensityTerminal, renderPpcStatTerminal } from "../src/terminal";

/** Builds a Samples set from per-variable, per-chain draw arrays (chain-major). */
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

/** Predictive draws for y[1..3]: draw s of chain c has value base + s + 10c per column offset. */
function predictive(): Samples {
  const draws = Array.from({ length: 20 }, (_, s) => s * 0.1);
  return makeSamples({
    "y[1]": [draws, draws.map((v) => v + 0.5)],
    "y[2]": [draws.map((v) => v + 1), draws.map((v) => v + 1.5)],
    "y[3]": [draws.map((v) => v + 2), draws.map((v) => v + 2.5)],
  });
}

const OBSERVED = [1.0, 2.0, 3.0];

describe("ppcDensityData", () => {
  it("builds replicate and observed densities on one grid", () => {
    const data = ppcDensityData(predictive(), OBSERVED, { maxReplicates: 10, gridSize: 64 });
    expect(data.kind).toBe("ppc-density");
    expect(data.variable).toBe("y");
    expect(data.nDraws).toBe(40);
    expect(data.nObservations).toBe(3);
    expect(data.replicates.length).toBeLessThanOrEqual(10);
    expect(data.replicates.length).toBeGreaterThan(0);
    expect(data.x).toHaveLength(64);
    expect(data.observed).toHaveLength(64);
    for (const curve of data.replicates) expect(curve).toHaveLength(64);
    // The grid must span the observed values.
    expect(data.x[0] as number).toBeLessThanOrEqual(1);
    expect(data.x[data.x.length - 1] as number).toBeGreaterThanOrEqual(3);
    // A density integrates to ~1 over the grid.
    const step = (data.x[1] as number) - (data.x[0] as number);
    const mass = data.observed.reduce((a, b) => a + b * step, 0);
    expect(mass).toBeGreaterThan(0.8);
    expect(mass).toBeLessThan(1.2);
  });

  it("rejects an observed vector of the wrong length", () => {
    expect(() => ppcDensityData(predictive(), [1, 2])).toThrow(/2 values but/);
  });

  it("needs a variable when several bases are present", () => {
    const mixed = makeSamples({
      "y[1]": [[1, 2, 3]],
      "z[1]": [[4, 5, 6]],
    });
    expect(() => ppcDensityData(mixed, [1])).toThrow(/pick one/);
    const data = ppcDensityData(mixed, [1], { variable: "z" });
    expect(data.variable).toBe("z");
  });
});

describe("ppcStatData", () => {
  it("computes the one-sided p-value exactly", () => {
    // Replicate means: chain draws are s*0.1 + offsets; construct so half the
    // replicate means sit at or above the observed mean.
    const data = ppcStatData(predictive(), OBSERVED, { stat: "mean" });
    expect(data.kind).toBe("ppc-stat");
    expect(data.stat).toBe("mean");
    expect(data.nDraws).toBe(40);
    // Observed mean is 2; replicate means are (s*0.1 + 1) + c*0.5 averaged over
    // columns: mean_s = s*0.1 + 1 (chain 1) or s*0.1 + 1.5 (chain 2). Counting
    // values >= 2: chain 1 has s >= 10 (10 draws), chain 2 has s >= 5 (15).
    expect(data.observed).toBeCloseTo(2, 12);
    expect(data.pValue).toBeCloseTo(25 / 40, 12);
  });

  it("supports sd, min, and max statistics", () => {
    const sd = ppcStatData(predictive(), OBSERVED, { stat: "sd" });
    // Every replicate row is {v, v+1, v+2} up to float round-off, sd ~ 1 like
    // the observed sd; the p-value stays away from both extremes.
    expect(sd.observed).toBeCloseTo(1, 12);
    expect(sd.pValue).toBeGreaterThan(0.2);
    expect(sd.pValue).toBeLessThanOrEqual(1);
    const min = ppcStatData(predictive(), OBSERVED, { stat: "min" });
    expect(min.observed).toBe(1);
    const max = ppcStatData(predictive(), OBSERVED, { stat: "max" });
    expect(max.observed).toBe(3);
  });

  it("rejects an unknown statistic", () => {
    expect(() => ppcStatData(predictive(), OBSERVED, { stat: "median" as never })).toThrow(
      /unknown ppc stat/,
    );
  });

  it("keeps counts summing to the draw total", () => {
    const data = ppcStatData(predictive(), OBSERVED, { bins: 7 });
    expect(data.counts.reduce((a, b) => a + b, 0)).toBe(40);
    expect(data.binEdges).toHaveLength(8);
  });
});

describe("ppc renderers", () => {
  const density = ppcDensityData(predictive(), OBSERVED, { maxReplicates: 5, gridSize: 32 });
  const stat = ppcStatData(predictive(), OBSERVED, {});

  it("renders SVG with the observed series on top of the replicates", () => {
    const svg = renderPpcDensitySVG(density);
    expect(svg).toContain("<svg");
    expect(svg).toContain("predictive check");
    expect(svg).toContain('opacity="0.35"');
    const statSvg = renderPpcStatSVG(stat);
    expect(statSvg).toContain("T = mean");
    expect(statSvg).toContain("p = ");
  });

  it("renders terminal output with headers and axes", () => {
    const text = renderPpcDensityTerminal(density, { width: 60, height: 8 });
    expect(text).toContain("predictive check");
    expect(text.split("\n").length).toBeGreaterThan(8);
    const statText = renderPpcStatTerminal(stat, { width: 60, height: 8 });
    expect(statText).toContain("T = mean");
    expect(statText).toContain("p = ");
  });
});
