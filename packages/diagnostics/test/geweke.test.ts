import { describe, expect, it } from "vitest";
import { geweke } from "../src/geweke";

const arr = (xs: number[]) => Float64Array.from(xs);
const ramp = (n: number) => arr(Array.from({ length: n }, (_, i) => i));

// Golden vectors produced by running MCMCVisualizer's computeGeweke (tsx) verbatim.
describe("geweke", () => {
  it("matches the reference z/pValue on a linear ramp (large |z|)", () => {
    const g = geweke(ramp(100));
    expect(g.z).toBeCloseTo(-11.395413343607668, 10);
    expect(g.pValue).toBe(0);
  });

  it("matches the reference on a sine wave", () => {
    const g = geweke(arr(Array.from({ length: 200 }, (_, i) => Math.sin(i / 5))));
    expect(g.z).toBeCloseTo(1.5198251479217397, 10);
    expect(g.pValue).toBeCloseTo(0.12855497044689357, 12);
  });

  it("matches the reference on an alternating series with slow trend", () => {
    const g = geweke(arr(Array.from({ length: 50 }, (_, i) => (i % 2 === 0 ? 1 : -1) + 0.01 * i)));
    expect(g.z).toBeCloseTo(-0.5433445824089649, 10);
    expect(g.pValue).toBeCloseTo(0.5868925160200571, 12);
  });

  it("returns NaN below the minimum chain length", () => {
    const g = geweke(ramp(19));
    expect(Number.isNaN(g.z)).toBe(true);
    expect(Number.isNaN(g.pValue)).toBe(true);
  });

  it("returns NaN for a constant (degenerate) chain", () => {
    const g = geweke(arr(new Array(30).fill(7)));
    expect(Number.isNaN(g.z)).toBe(true);
    expect(Number.isNaN(g.pValue)).toBe(true);
  });
});
