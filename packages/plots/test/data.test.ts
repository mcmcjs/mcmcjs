import type { Samples } from "@mcmcjs/core";
import { describe, expect, it } from "vitest";
import { chainsOf, forestData, traceData } from "../src/data";

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
    [1, 2, 3, 4, 5, 6],
    [2, 3, 4, 5, 6, 7],
    [0, 1, 2, 3, 4, 5],
  ],
  theta: [
    [-1, 0, 1, 0, -1, 0],
    [0, 1, 2, 1, 0, 1],
    [-2, -1, 0, -1, -2, -1],
  ],
});

describe("chainsOf", () => {
  it("splits a variable into one no-copy view per chain", () => {
    const chains = chainsOf(samples, "mu");
    expect(chains).toHaveLength(3);
    expect(Array.from(chains[1] as Float64Array)).toEqual([2, 3, 4, 5, 6, 7]);
  });
});

describe("traceData", () => {
  it("returns each chain's draws plus diagnostics", () => {
    const td = traceData(samples, "mu");
    expect(td.kind).toBe("trace");
    expect(td.variable).toBe("mu");
    expect(td.nChains).toBe(3);
    expect(td.nDraws).toBe(6);
    expect(td.chains[2]).toEqual([0, 1, 2, 3, 4, 5]);
    expect(typeof td.rhat).toBe("number");
    expect(typeof td.essBulk).toBe("number");
  });
});

describe("forestData", () => {
  it("returns one row per variable with HDI, IQR, and a convergence flag", () => {
    const fd = forestData(samples, { hdiProb: 0.9 });
    expect(fd.kind).toBe("forest");
    expect(fd.hdiProb).toBe(0.9);
    expect(fd.rows.map((r) => r.variable)).toEqual(["mu", "theta"]);
    const mu = fd.rows[0];
    if (!mu) throw new Error("missing mu row");
    expect(mu.hdi[0]).toBeLessThanOrEqual(mu.mean);
    expect(mu.hdi[1]).toBeGreaterThanOrEqual(mu.mean);
    expect(mu.iqr[0]).toBeLessThanOrEqual(mu.iqr[1]);
    expect(typeof mu.converged).toBe("boolean");
  });

  it("restricts to the requested variables", () => {
    const fd = forestData(samples, { variables: ["theta"] });
    expect(fd.rows).toHaveLength(1);
    expect(fd.rows[0]?.variable).toBe("theta");
  });
});
