import { describe, expect, it } from "vitest";
import { parseSamples } from "../../src/parse-samples";
import { looksLikeTuringCsv, parseTuringCsv } from "../../src/parsers/turing-csv";
import { chainView } from "../../src/types";

const WIDE_ITER = `iteration,chain,alpha,beta
1,chain#1,1.5,0.5
2,chain#1,2.3,0.7
3,chain#1,1.8,0.6
4,chain#1,2.1,0.8
5,chain#1,1.9,0.55
1,chain#2,1.6,0.45
2,chain#2,2.4,0.65
3,chain#2,1.7,0.55
4,chain#2,2.0,0.75
5,chain#2,2.2,0.6`;

const WIDE_EXPORT = `chain_,draw_,alpha,beta
chain#1,1,1.5,0.5
chain#1,2,2.3,0.7
chain#1,3,1.8,0.6
chain#1,4,2.1,0.8
chain#1,5,1.9,0.55
chain#2,1,1.6,0.45
chain#2,2,2.4,0.65
chain#2,3,1.7,0.55
chain#2,4,2.0,0.75
chain#2,5,2.2,0.6`;

const LONG = `chain#1,alpha,0,1.5
chain#1,alpha,1,2.3
chain#1,alpha,2,1.8
chain#1,alpha,3,2.1
chain#1,alpha,4,1.9
chain#1,beta,0,0.5
chain#1,beta,1,0.7
chain#1,beta,2,0.6
chain#1,beta,3,0.8
chain#1,beta,4,0.55
chain#2,alpha,0,1.6
chain#2,alpha,1,2.4
chain#2,alpha,2,1.7
chain#2,alpha,3,2.0
chain#2,alpha,4,2.2
chain#2,beta,0,0.45
chain#2,beta,1,0.65
chain#2,beta,2,0.55
chain#2,beta,3,0.75
chain#2,beta,4,0.6`;

describe("parseTuringCsv", () => {
  it("parses the wide iteration,chain layout chain-major", () => {
    const s = parseTuringCsv(WIDE_ITER);
    expect(s.variables).toEqual(["alpha", "beta"]);
    expect(s.nChains).toBe(2);
    expect(s.nDraws).toBe(5);
    expect(Array.from(s.draws.get("alpha") as Float64Array)).toEqual([
      1.5, 2.3, 1.8, 2.1, 1.9, 1.6, 2.4, 1.7, 2.0, 2.2,
    ]);
    expect(Array.from(chainView(s, "beta", 1))).toEqual([0.45, 0.65, 0.55, 0.75, 0.6]);
  });

  it("parses the chain_,draw_ export layout identically", () => {
    const a = parseTuringCsv(WIDE_ITER);
    const b = parseTuringCsv(WIDE_EXPORT);
    expect(Array.from(b.draws.get("alpha") as Float64Array)).toEqual(
      Array.from(a.draws.get("alpha") as Float64Array),
    );
    expect(b.nChains).toBe(2);
    expect(b.nDraws).toBe(5);
  });

  it("parses the headerless long layout", () => {
    const s = parseTuringCsv(LONG);
    expect(s.variables).toEqual(["alpha", "beta"]);
    expect(s.nChains).toBe(2);
    expect(s.nDraws).toBe(5);
    expect(Array.from(chainView(s, "alpha", 0))).toEqual([1.5, 2.3, 1.8, 2.1, 1.9]);
    expect(Array.from(chainView(s, "alpha", 1))).toEqual([1.6, 2.4, 1.7, 2.0, 2.2]);
  });

  it("keeps non-numeric cells as NaN in place (rectangular, unlike the reference)", () => {
    const s = parseTuringCsv(`iteration,chain,alpha,beta
1,chain#1,1.5,0.5
2,chain#1,NaN,0.7
3,chain#1,1.8,0.6`);
    expect(s.nDraws).toBe(3);
    expect(Number.isNaN(chainView(s, "alpha", 0)[1] as number)).toBe(true);
    expect(Array.from(chainView(s, "beta", 0))).toEqual([0.5, 0.7, 0.6]);
  });

  it("auto-detects via parseSamples", () => {
    expect(looksLikeTuringCsv(WIDE_ITER)).toBe(true);
    const s = parseSamples(WIDE_ITER);
    expect(s.nChains).toBe(2);
  });

  it("does not classify a generic 4-column numeric CSV as Turing long", () => {
    // non-integer iteration column -> not Turing long
    expect(looksLikeTuringCsv("chain#1,alpha,0.5,1.5")).toBe(false);
  });
});
