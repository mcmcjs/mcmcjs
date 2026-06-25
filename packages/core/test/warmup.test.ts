import { describe, expect, it } from "vitest";
import { fromChainArrays } from "../src/parsers/from-chains";
import { chainView } from "../src/types";
import { dropWarmup } from "../src/warmup";

describe("dropWarmup", () => {
  // 2 chains x 4 draws: chain0 = [1,2,3,4], chain1 = [5,6,7,8].
  const base = fromChainArrays({ chain_1: { x: [1, 2, 3, 4] }, chain_2: { x: [5, 6, 7, 8] } });

  it("discards the first n draws of every chain, rebuilding the chain-major layout", () => {
    const dropped = dropWarmup(base, 2);
    expect(dropped.nDraws).toBe(2);
    expect(dropped.nChains).toBe(2);
    expect(Array.from(chainView(dropped, "x", 0))).toEqual([3, 4]);
    expect(Array.from(chainView(dropped, "x", 1))).toEqual([7, 8]);
    expect(Array.from(dropped.draws.get("x") as Float64Array)).toEqual([3, 4, 7, 8]);
  });

  it("treats n >= nDraws as fully empty (nDraws = 0)", () => {
    const dropped = dropWarmup(base, 4);
    expect(dropped.nDraws).toBe(0);
    expect(dropped.nChains).toBe(2);
    expect((dropped.draws.get("x") as Float64Array).length).toBe(0);
  });

  it("treats negative n as zero", () => {
    const dropped = dropWarmup(base, -3);
    expect(dropped.nDraws).toBe(4);
    expect(Array.from(dropped.draws.get("x") as Float64Array)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("rebuilds sampler stats alongside model variables", () => {
    const s = fromChainArrays({ chain_1: { x: [1, 2, 3] } });
    const withStats = {
      ...s,
      sampleStats: new Map([["lp", new Float64Array([10, 20, 30])]]),
    };
    const dropped = dropWarmup(withStats, 1);
    expect(dropped.nDraws).toBe(2);
    expect(Array.from(dropped.sampleStats.get("lp") as Float64Array)).toEqual([20, 30]);
  });
});
