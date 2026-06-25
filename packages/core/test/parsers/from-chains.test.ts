import { describe, expect, it } from "vitest";
import { fromChainArrays } from "../../src/parsers/from-chains";
import { chainView } from "../../src/types";

describe("fromChainArrays", () => {
  it("builds chain-major Samples from per-chain arrays", () => {
    const s = fromChainArrays({ chain_0: { mu: [1, 2, 3] }, chain_1: { mu: [4, 5, 6] } });
    expect(s.variables).toEqual(["mu"]);
    expect(s.nChains).toBe(2);
    expect(s.nDraws).toBe(3);
    expect(Array.from(s.draws.get("mu") as Float64Array)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(Array.from(chainView(s, "mu", 0))).toEqual([1, 2, 3]);
    expect(Array.from(chainView(s, "mu", 1))).toEqual([4, 5, 6]);
  });

  it("throws on length mismatch and missing variables", () => {
    expect(() => fromChainArrays({ a: { mu: [1, 2] }, b: { mu: [3] } })).toThrow(/draws/);
    expect(() => fromChainArrays({ a: { mu: [1] }, b: { sigma: [3] } })).toThrow(/missing/);
    expect(() => fromChainArrays({})).toThrow(/no chains/);
  });
});
