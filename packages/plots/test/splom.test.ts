import type { Samples } from "@mcmcjs/core";
import { describe, expect, it } from "vitest";
import { splomData } from "../src/data";
import { renderSplomSVG } from "../src/svg";
import { renderSplomTerminal } from "../src/terminal";

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
    [1, 2, 3, 4, 5],
    [2, 3, 4, 5, 6],
  ],
  tau: [
    [5, 4, 3, 2, 1],
    [6, 5, 4, 3, 2],
  ],
});

describe("splomData", () => {
  it("keys cell point chains to chain identity when chainIds are present", () => {
    const d = splomData(samples, undefined, { chainIds: [1, 3] });
    const cell = d.cells[0];
    expect(cell).toBeDefined();
    expect(new Set(cell?.chain)).toEqual(new Set([1, 3]));
  });

  const sd = splomData(samples);

  it("keeps the requested variables and chain count", () => {
    expect(sd.kind).toBe("splom");
    expect(sd.vars).toEqual(["mu", "tau"]);
    expect(sd.nChains).toBe(2);
  });

  it("has one diagonal KDE per variable", () => {
    expect(sd.diagonals).toHaveLength(sd.vars.length);
    for (const d of sd.diagonals) {
      expect(d.x.length).toBe(d.density.length);
      expect(Math.max(...d.density)).toBeLessThanOrEqual(1);
    }
  });

  it("has the upper-triangle correlation entries with finite stats", () => {
    expect(sd.corr).toHaveLength(1);
    const [c] = sd.corr;
    expect(c).toBeDefined();
    expect(c?.row).toBe(0);
    expect(c?.col).toBe(1);
    expect(Number.isFinite(c?.pearson ?? Number.NaN)).toBe(true);
    expect(Number.isFinite(c?.spearman ?? Number.NaN)).toBe(true);
  });

  it("has one lower-triangle cell per lower-triangle pair", () => {
    const n = sd.vars.length;
    expect(sd.cells).toHaveLength((n * (n - 1)) / 2);
    for (const cell of sd.cells) {
      expect(cell.x.length).toBe(cell.y.length);
      expect(cell.x.length).toBe(cell.chain.length);
    }
  });

  it("caps the requested variables via maxVars", () => {
    expect(splomData(samples, undefined, { maxVars: 1 }).vars).toEqual(["mu"]);
  });
});

describe("splom renderers", () => {
  const sd = splomData(samples);

  it("renders a non-empty SVG", () => {
    const svg = renderSplomSVG(sd);
    expect(svg).toContain("<svg");
    expect(svg.length).toBeGreaterThan(100);
  });

  it("renders a non-empty terminal matrix", () => {
    const out = renderSplomTerminal(sd);
    expect(out).toContain("pairs");
    expect(out).toContain("1.00");
  });
});
