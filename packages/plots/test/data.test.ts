import type { Samples } from "@mcmcjs/core";
import { describe, expect, it } from "vitest";
import {
  autocorrData,
  chainsOf,
  densityData,
  energyData,
  forestData,
  histogramData,
  pairData,
  rankData,
  traceData,
} from "../src/data";

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

describe("densityData", () => {
  it("returns one non-negative KDE curve per chain over a shared ascending grid", () => {
    const dd = densityData(samples, "mu", { gridSize: 64 });
    expect(dd.kind).toBe("density");
    expect(dd.x).toHaveLength(64);
    expect(dd.chains).toHaveLength(3);
    expect(dd.chains[0]).toHaveLength(64);
    expect((dd.x[0] as number) < (dd.x[63] as number)).toBe(true);
    const curve = dd.chains[0] as number[];
    expect(Math.max(...curve)).toBeGreaterThan(0);
    expect(Math.min(...curve)).toBeGreaterThanOrEqual(0);
  });
});

describe("histogramData", () => {
  it("bins pooled draws so the counts sum to the number of draws", () => {
    const hd = histogramData(samples, "mu");
    expect(hd.kind).toBe("histogram");
    expect(hd.binEdges).toHaveLength(hd.counts.length + 1);
    expect(hd.counts.reduce((a, b) => a + b, 0)).toBe(hd.total);
    expect(hd.total).toBe(samples.nChains * samples.nDraws);
  });

  it("honors an explicit bin count", () => {
    const hd = histogramData(samples, "mu", { bins: 5 });
    expect(hd.counts).toHaveLength(5);
    expect(hd.binEdges).toHaveLength(6);
  });
});

describe("rankData", () => {
  it("counts each chain's ranks into bins that sum to its draw count", () => {
    const rd = rankData(samples, "mu", { bins: 4 });
    expect(rd.kind).toBe("rank");
    expect(rd.bins).toBe(4);
    expect(rd.counts).toHaveLength(3);
    for (const row of rd.counts) {
      expect(row).toHaveLength(4);
      expect(row.reduce((a, b) => a + b, 0)).toBe(samples.nDraws);
    }
    expect(rd.expected).toBe(samples.nDraws / 4);
  });
});

describe("autocorrData", () => {
  it("returns an ACF per chain starting at 1.0 for lag 0", () => {
    const ad = autocorrData(samples, "mu", { maxLag: 4 });
    expect(ad.kind).toBe("autocorr");
    expect(ad.nChains).toBe(3);
    expect(ad.lags[0]).toBe(0);
    const acf = ad.chains[0] as number[];
    expect(acf.length).toBeGreaterThan(0);
    expect(acf.length).toBeLessThanOrEqual(5);
    expect(acf[0]).toBeCloseTo(1, 6);
  });
});

describe("pairData", () => {
  it("pools two variables into aligned point arrays labeled by chain", () => {
    const pd = pairData(samples, "mu", "theta");
    expect(pd.kind).toBe("pair");
    expect(pd.xVar).toBe("mu");
    expect(pd.yVar).toBe("theta");
    const n = samples.nChains * samples.nDraws;
    expect(pd.x).toHaveLength(n);
    expect(pd.y).toHaveLength(n);
    expect(pd.chain[0]).toBe(0);
    expect(pd.chain[n - 1]).toBe(samples.nChains - 1);
    expect(pd.diverging.every((d) => d === false)).toBe(true);
  });
});

describe("energyData", () => {
  const energy = new Float64Array(samples.nChains * samples.nDraws);
  for (let i = 0; i < energy.length; i++) energy[i] = Math.sin(i) * 3 + i * 0.1;
  const withEnergy: Samples = {
    ...samples,
    sampleStats: new Map([["hamiltonian_energy", energy]]),
  };

  it("bins marginal and transition energy and computes per-chain BFMI", () => {
    const ed = energyData(withEnergy, { bins: 8 });
    expect(ed.kind).toBe("energy");
    expect(ed.edges).toHaveLength(9);
    expect(ed.marginal).toHaveLength(8);
    expect(ed.transition).toHaveLength(8);
    expect(ed.marginal.reduce((a, b) => a + b, 0)).toBe(samples.nChains * samples.nDraws);
    expect(ed.transition.reduce((a, b) => a + b, 0)).toBe(samples.nChains * (samples.nDraws - 1));
    expect(ed.bfmi).toHaveLength(samples.nChains);
  });

  it("throws when no energy statistic is present", () => {
    expect(() => energyData(samples)).toThrow(/hamiltonian_energy/);
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
