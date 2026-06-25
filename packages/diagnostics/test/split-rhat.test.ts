import { describe, expect, it } from "vitest";
import { computeESS as essIMSE } from "../src/ess";
import { splitRhat } from "../src/split-rhat";

const arr = (xs: number[]) => Float64Array.from(xs);

// Golden chains shared with the table-plots parity work (2 chains x 24 draws of `mu`).
const chain1 = arr([
  -0.9591946285, -1.4465016178, -0.6369392199, -0.0486614978, 0.7957282786, -0.3772125224,
  -0.1968274507, -0.0017160368, 0.1913422158, 0.66257194, -0.5890053951, 0.1930997473, 1.0281686088,
  -0.3385806138, 0.229923552, 0.0355501245, -0.189257907, 0.8244136203, 0.2244574122, 1.0177570191,
  1.496235176, 1.0755187227, 0.3835505196, 0.1916245276,
]);
const chain2 = arr([
  0.3940045011, -0.3386300733, 0.3089707781, 0.7223824374, 1.0678256658, 1.1090608022, 0.6002250029,
  -0.0206651172, -0.5039611927, 0.4180686609, -0.1789823413, 0.3320493435, 0.7625485118,
  1.0983085377, -0.0908128588, 0.5436444844, 0.1162317882, -0.2702313459, -0.4526671339,
  -0.6997442287, -0.3594104146, 0.9532199656, 0.6221592998, 0.6600678389,
]);

describe("splitRhat", () => {
  it("matches the classic split-R-hat golden value", () => {
    expect(splitRhat([chain1, chain2])).toBeCloseTo(1.0834101, 6);
  });

  it("works on a single chain (it splits into two halves)", () => {
    expect(Number.isFinite(splitRhat([chain1]))).toBe(true);
  });

  it("returns NaN when a half is too short", () => {
    expect(Number.isNaN(splitRhat([arr([1, 2])]))).toBe(true);
  });

  it("returns NaN for a constant chain (zero within-chain variance)", () => {
    expect(Number.isNaN(splitRhat([arr(new Array(24).fill(3))]))).toBe(true);
  });
});

describe("essIMSE", () => {
  it("sums to the single-chain IMSE golden value across chains", () => {
    const total = essIMSE(chain1).ess + essIMSE(chain2).ess;
    expect(total).toBeCloseTo(34.313502, 4);
  });
});
