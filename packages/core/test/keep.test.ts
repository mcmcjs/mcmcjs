import { describe, expect, it } from "vitest";
import { keepMatcher, keepSamples } from "../src/keep";
import type { Samples } from "../src/types";

describe("keepMatcher", () => {
  const keep = (patterns: string[], name: string) => keepMatcher(patterns)(name);

  it("matches a full scalarised name exactly", () => {
    expect(keep(["theta[2]"], "theta[2]")).toBe(true);
    expect(keep(["theta[2]"], "theta[1]")).toBe(false);
  });

  it("a base name keeps every element of an array", () => {
    expect(keep(["theta"], "theta[1]")).toBe(true);
    expect(keep(["theta"], "theta[1,2]")).toBe(true);
    expect(keep(["theta"], "theta")).toBe(true);
    expect(keep(["theta"], "theta2")).toBe(false);
    expect(keep(["theta"], "thetas[1]")).toBe(false);
  });

  it("a glob matches the name or the base name", () => {
    expect(keep(["mean.*"], "mean.BL")).toBe(true);
    expect(keep(["mean.*"], "mean.C[3]")).toBe(true);
    expect(keep(["*.tau"], "alpha.tau")).toBe(true);
    expect(keep(["B*"], "BL[12]")).toBe(true);
    expect(keep(["mean.*"], "var.BL")).toBe(false);
  });

  it("dots and brackets in patterns are literal, not regex", () => {
    expect(keep(["tau.c"], "tauXc")).toBe(false);
    expect(keep(["p[1]"], "p1")).toBe(false);
  });

  it("any pattern in the list may match", () => {
    const m = keepMatcher(["alpha0", "beta.c", "sigma"]);
    expect(["alpha0", "beta.c", "sigma"].every(m)).toBe(true);
    expect(m("alpha[3]")).toBe(false);
  });
});

describe("keepSamples", () => {
  const samples: Samples = {
    variables: ["mu", "theta[1]", "theta[2]", "pi[1,1]", "pi[1,2]"],
    nChains: 1,
    nDraws: 2,
    draws: new Map([
      ["mu", Float64Array.of(0, 1)],
      ["theta[1]", Float64Array.of(2, 3)],
      ["theta[2]", Float64Array.of(4, 5)],
      ["pi[1,1]", Float64Array.of(6, 7)],
      ["pi[1,2]", Float64Array.of(8, 9)],
    ]),
    sampleStats: new Map([["lp", Float64Array.of(-1, -2)]]),
  };

  it("keeps only the named variables, in their original order", () => {
    const out = keepSamples(samples, ["theta", "mu"]);
    expect(out.variables).toEqual(["mu", "theta[1]", "theta[2]"]);
    expect([...out.draws.keys()]).toEqual(["mu", "theta[1]", "theta[2]"]);
    expect(out.draws.get("theta[2]")).toBe(samples.draws.get("theta[2]"));
  });

  it("never touches the sampler statistics", () => {
    const out = keepSamples(samples, ["mu"]);
    expect(out.sampleStats).toBe(samples.sampleStats);
    expect(out.nChains).toBe(1);
    expect(out.nDraws).toBe(2);
  });

  it("no patterns means no filtering", () => {
    expect(keepSamples(samples)).toBe(samples);
    expect(keepSamples(samples, [])).toBe(samples);
  });

  it("a list that matches nothing leaves an empty variable set rather than throwing", () => {
    const out = keepSamples(samples, ["nothing.here"]);
    expect(out.variables).toEqual([]);
    expect(out.draws.size).toBe(0);
  });
});
