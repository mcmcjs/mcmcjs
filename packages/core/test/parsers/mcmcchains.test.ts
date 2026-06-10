import { describe, expect, it } from "vitest";
import {
  type MCMCChainsJson,
  parseMCMCChainsJson,
  toMCMCChainsJson,
} from "../../src/parsers/mcmcchains";
import { chainView } from "../../src/types";

const fixture: MCMCChainsJson = {
  size: [3, 2, 2],
  value_flat: [1, 2, 3, 0.5, 0.6, 0.7, 1.1, 2.1, 3.1, 0.4, 0.5, 0.6],
  iterations: [1, 2, 3],
  parameters: ["mu", "sigma"],
  chains: [1, 2],
  name_map: { parameters: ["mu", "sigma"], internals: [] },
  info: {},
};

describe("parseMCMCChainsJson", () => {
  it("parses dimensions and variable names", () => {
    const s = parseMCMCChainsJson(fixture);
    expect(s.nChains).toBe(2);
    expect(s.nDraws).toBe(3);
    expect(s.variables).toEqual(["mu", "sigma"]);
  });

  it("lays out draws chain-major", () => {
    const s = parseMCMCChainsJson(fixture);
    expect([...chainView(s, "mu", 0)]).toEqual([1, 2, 3]);
    expect([...chainView(s, "mu", 1)]).toEqual([1.1, 2.1, 3.1]);
    expect([...chainView(s, "sigma", 0)]).toEqual([0.5, 0.6, 0.7]);
    expect([...chainView(s, "sigma", 1)]).toEqual([0.4, 0.5, 0.6]);
  });

  it("accepts a JSON string as well as an object", () => {
    const s = parseMCMCChainsJson(JSON.stringify(fixture));
    expect([...chainView(s, "mu", 0)]).toEqual([1, 2, 3]);
  });

  it("routes internals to sampleStats", () => {
    const s = parseMCMCChainsJson({
      ...fixture,
      name_map: { parameters: ["mu"], internals: ["sigma"] },
    });
    expect(s.variables).toEqual(["mu"]);
    expect(s.sampleStats.has("sigma")).toBe(true);
  });

  it("throws on a value_flat length mismatch", () => {
    expect(() => parseMCMCChainsJson({ ...fixture, value_flat: [1, 2, 3] })).toThrow(/length/);
  });

  it("round-trips losslessly through toMCMCChainsJson", () => {
    const again = parseMCMCChainsJson(toMCMCChainsJson(parseMCMCChainsJson(fixture)));
    expect(again.nDraws).toBe(3);
    expect([...chainView(again, "mu", 1)]).toEqual([1.1, 2.1, 3.1]);
    expect([...chainView(again, "sigma", 0)]).toEqual([0.5, 0.6, 0.7]);
  });
});
