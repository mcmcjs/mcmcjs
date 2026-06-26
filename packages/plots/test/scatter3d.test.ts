import type { Samples } from "@mcmcjs/core";
import { describe, expect, it } from "vitest";
import { scatter3dData } from "../src/data";

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
  x: [
    [0, 1, 2, 3],
    [4, 5, 6, 8],
  ],
  y: [
    [-2, -1, 0, 1],
    [2, 3, 4, 6],
  ],
  z: [
    [10, 11, 12, 13],
    [14, 15, 16, 20],
  ],
});

describe("scatter3dData", () => {
  const sd = scatter3dData(samples, "x", "y", "z");

  it("tags the kind and variables and chain count", () => {
    expect(sd.kind).toBe("scatter3d");
    expect(sd.varX).toBe("x");
    expect(sd.varY).toBe("y");
    expect(sd.varZ).toBe("z");
    expect(sd.nChains).toBe(2);
    expect(sd.chains).toHaveLength(2);
  });

  it("computes the global bbox over all chains", () => {
    expect(sd.bbox).toEqual({
      minX: 0,
      maxX: 8,
      minY: -2,
      maxY: 6,
      minZ: 10,
      maxZ: 20,
    });
  });

  it("maps the global min/max raw values to the NDC endpoints [-1, 1]", () => {
    // chain 0 holds the global minima (x=0, y=-2, z=10); chain 1 holds the maxima.
    const c0 = sd.chains[0];
    const c1 = sd.chains[1];
    expect(c0).toBeDefined();
    expect(c1).toBeDefined();
    expect(c0?.normX[0]).toBeCloseTo(-1, 12);
    expect(c0?.normY[0]).toBeCloseTo(-1, 12);
    expect(c0?.normZ[0]).toBeCloseTo(-1, 12);
    const last = (c1?.rawX.length ?? 0) - 1;
    expect(c1?.normX[last]).toBeCloseTo(1, 12);
    expect(c1?.normY[last]).toBeCloseTo(1, 12);
    expect(c1?.normZ[last]).toBeCloseTo(1, 12);
  });

  it("keeps raw and norm arrays aligned per chain", () => {
    for (const ch of sd.chains) {
      const n = ch.rawX.length;
      expect(ch.rawY).toHaveLength(n);
      expect(ch.rawZ).toHaveLength(n);
      expect(ch.normX).toHaveLength(n);
      expect(ch.normY).toHaveLength(n);
      expect(ch.normZ).toHaveLength(n);
    }
  });

  it("respects the per-chain subsample cap", () => {
    // 1000 draws / 2 chains -> perChainMax = max(50, 500) = 500.
    const big = makeSamples({
      x: [Array.from({ length: 1000 }, (_, i) => i), Array.from({ length: 1000 }, (_, i) => i)],
      y: [Array.from({ length: 1000 }, (_, i) => -i), Array.from({ length: 1000 }, (_, i) => i)],
      z: [Array.from({ length: 1000 }, (_, i) => 2 * i), Array.from({ length: 1000 }, (_, i) => i)],
    });
    const capped = scatter3dData(big, "x", "y", "z", { maxPoints: 1000 });
    for (const ch of capped.chains) {
      expect(ch.rawX.length).toBeLessThanOrEqual(500);
    }
    // The endpoints survive decimation.
    const c0 = capped.chains[0];
    expect(c0?.rawX[0]).toBe(0);
    expect(c0?.rawX[(c0?.rawX.length ?? 1) - 1]).toBe(999);
  });

  it("enforces the floor of 50 points per chain", () => {
    // maxPoints 10 over 2 chains floors to max(50, 5) = 50; with only 4 draws, keeps all 4.
    const capped = scatter3dData(samples, "x", "y", "z", { maxPoints: 10 });
    expect(capped.chains[0]?.rawX).toHaveLength(4);
  });
});
