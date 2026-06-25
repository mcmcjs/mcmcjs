import type { Samples } from "@mcmcjs/core";
import { describe, expect, it } from "vitest";
import { parallelCoordsData } from "../src/data";
import { renderParallelCoordsSVG } from "../src/svg";
import { renderParallelCoordsTerminal } from "../src/terminal";

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

const samples = makeSamples({
  mu: [
    [1, 2, 3, 4, 5],
    [2, 3, 4, 5, 6],
  ],
  tau: [
    [5, 4, 3, 2, 1],
    [6, 5, 4, 3, 2],
  ],
});

describe("parallelCoordsData", () => {
  const pc = parallelCoordsData(samples);

  it("keeps the variables and one bound per variable", () => {
    expect(pc.kind).toBe("parallel-coords");
    expect(pc.vars).toEqual(["mu", "tau"]);
    expect(pc.bounds).toHaveLength(pc.vars.length);
    for (const b of pc.bounds) expect(b.max).toBeGreaterThanOrEqual(b.min);
  });

  it("produces lines with one value per variable", () => {
    expect(pc.lines.length).toBeGreaterThan(0);
    for (const line of pc.lines) {
      expect(line.values).toHaveLength(pc.vars.length);
      expect(line.chain).toBeGreaterThanOrEqual(0);
    }
  });

  it("caps the line count via maxSamples", () => {
    const capped = parallelCoordsData(samples, undefined, { maxSamples: 2 });
    expect(capped.lines.length).toBeLessThanOrEqual(samples.nChains * samples.nDraws);
  });
});

describe("parallel-coords renderers", () => {
  const pc = parallelCoordsData(samples);

  it("renders a non-empty SVG", () => {
    const svg = renderParallelCoordsSVG(pc);
    expect(svg).toContain("<svg");
    expect(svg.length).toBeGreaterThan(100);
  });

  it("renders a non-empty terminal summary", () => {
    const out = renderParallelCoordsTerminal(pc);
    expect(out).toContain("parallel coordinates");
    expect(out).toContain("mu");
  });
});
