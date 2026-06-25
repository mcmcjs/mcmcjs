import { describe, expect, it } from "vitest";
import { fromStanCSV, fromStanCSVFiles, fromStanName } from "../../src/parsers/stan";
import { chainView } from "../../src/types";

const HEADER =
  "lp__,accept_stat__,stepsize__,treedepth__,n_leapfrog__,divergent__,energy__,mu,a.1.1,a.1.2";
const FILE1 = `# comment
# Adaptation terminated
${HEADER}
-1.0,0.91,0.5,2,3,0,2.5,0.10,1.10,2.10
-1.2,0.95,0.5,2,3,1,2.7,0.20,1.20,2.20
-0.9,0.88,0.5,3,7,0,2.4,0.30,1.30,2.30`;
const FILE2 = `# comment
${HEADER}
-1.1,0.90,0.5,2,3,0,2.6,0.40,1.40,2.40
-1.3,0.93,0.5,2,3,0,2.8,0.50,1.50,2.50
-0.8,0.85,0.5,3,7,1,2.3,0.60,1.60,2.60`;

describe("fromStanName", () => {
  it("maps dotted indices to bracket form, all-or-nothing", () => {
    expect(fromStanName("a.1.2")).toBe("a[1,2]");
    expect(fromStanName("theta.3")).toBe("theta[3]");
    expect(fromStanName("mu")).toBe("mu");
    expect(fromStanName("lp__")).toBe("lp__");
    expect(fromStanName("tau.1.1.1")).toBe("tau[1,1,1]");
    expect(fromStanName("x.0")).toBe("x[0]");
    expect(fromStanName("y.1.2.foo")).toBe("y.1.2.foo");
    expect(fromStanName("b.")).toBe("b.");
  });
});

describe("fromStanCSV", () => {
  it("parses one file, excluding diagnostics from variables", () => {
    const s = fromStanCSV(FILE1);
    expect(s.nChains).toBe(1);
    expect(s.nDraws).toBe(3);
    expect(s.variables).toEqual(["mu", "a[1,1]", "a[1,2]"]);
    expect(Array.from(chainView(s, "mu", 0))).toEqual([0.1, 0.2, 0.3]);
    expect(Array.from(s.sampleStats.get("energy") as Float64Array)).toEqual([2.5, 2.7, 2.4]);
  });

  it("merges multiple files chain-major and renames diagnostics", () => {
    const s = fromStanCSVFiles([FILE1, FILE2]);
    expect(s.nChains).toBe(2);
    expect(s.nDraws).toBe(3);
    expect(Array.from(s.draws.get("mu") as Float64Array)).toEqual([0.1, 0.2, 0.3, 0.4, 0.5, 0.6]);
    expect(Array.from(s.draws.get("a[1,2]") as Float64Array)).toEqual([
      2.1, 2.2, 2.3, 2.4, 2.5, 2.6,
    ]);
    expect(Array.from(s.sampleStats.get("diverging") as Float64Array)).toEqual([0, 1, 0, 0, 0, 1]);
    expect(Array.from(s.sampleStats.get("lp") as Float64Array)).toEqual([
      -1, -1.2, -0.9, -1.1, -1.3, -0.8,
    ]);
    expect(Array.from(chainView(s, "mu", 1))).toEqual([0.4, 0.5, 0.6]);
    const div = s.sampleStats.get("diverging") as Float64Array;
    expect(div.reduce((a, b) => a + b, 0)).toBe(2);
  });

  it("drops non-whitelisted __-columns", () => {
    const s = fromStanCSV(`lp__,foo__,mu
-1.0,9,0.1
-1.2,9,0.2`);
    expect(s.variables).toEqual(["mu"]);
    expect(s.sampleStats.has("foo__")).toBe(false);
    expect(s.sampleStats.has("lp")).toBe(true);
  });

  it("throws when chains disagree on draw count", () => {
    const short = `${HEADER}\n-1.0,0.91,0.5,2,3,0,2.5,0.1,1.1,2.1`;
    expect(() => fromStanCSVFiles([FILE1, short])).toThrow(/draw counts/);
  });
});
