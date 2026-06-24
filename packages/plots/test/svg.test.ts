import { describe, expect, it } from "vitest";
import {
  renderAutocorrSVG,
  renderDensitySVG,
  renderEnergySVG,
  renderForestSVG,
  renderHistogramSVG,
  renderPairSVG,
  renderRankSVG,
  renderTraceSVG,
} from "../src/svg";

const countMatches = (s: string, re: RegExp): number => (s.match(re) ?? []).length;

describe("SVG renderers", () => {
  it("renderTraceSVG emits a standalone svg with a path per chain", () => {
    const out = renderTraceSVG({
      kind: "trace",
      variable: "mu",
      nChains: 2,
      nDraws: 5,
      chains: [
        [1, 2, 3, 4, 5],
        [5, 4, 3, 2, 1],
      ],
      rhat: 1.01,
      essBulk: 300,
    });
    expect(out.startsWith("<svg")).toBe(true);
    expect(out).toContain("</svg>");
    expect(countMatches(out, /<path/g)).toBeGreaterThanOrEqual(2);
    expect(out).toContain("mu");
  });

  it("renderDensitySVG emits a curve per chain", () => {
    const out = renderDensitySVG({
      kind: "density",
      variable: "mu",
      nChains: 2,
      x: [0, 1, 2, 3],
      chains: [
        [0, 0.5, 0.5, 0],
        [0, 0.2, 0.8, 0],
      ],
    });
    expect(countMatches(out, /<path/g)).toBeGreaterThanOrEqual(2);
  });

  it("renderHistogramSVG emits a bar per bin", () => {
    const out = renderHistogramSVG({
      kind: "histogram",
      variable: "mu",
      binEdges: [0, 1, 2, 3],
      counts: [2, 5, 1],
      total: 8,
    });
    // background card + 3 bars
    expect(countMatches(out, /<rect/g)).toBeGreaterThanOrEqual(4);
  });

  it("renderAutocorrSVG emits a zero line and a curve per chain", () => {
    const out = renderAutocorrSVG({
      kind: "autocorr",
      variable: "mu",
      nChains: 2,
      maxLag: 3,
      lags: [0, 1, 2, 3],
      chains: [
        [1, 0.5, 0.2, 0.1],
        [1, 0.3, 0.1, 0],
      ],
    });
    expect(countMatches(out, /<path/g)).toBeGreaterThanOrEqual(2);
    expect(out).toContain("autocorrelation");
  });

  it("renderRankSVG emits a stepped outline per chain", () => {
    const out = renderRankSVG({
      kind: "rank",
      variable: "mu",
      nChains: 2,
      bins: 4,
      counts: [
        [1, 2, 3, 4],
        [4, 3, 2, 1],
      ],
      expected: 2.5,
    });
    expect(countMatches(out, /<path/g)).toBeGreaterThanOrEqual(2);
    expect(out).toContain("rank");
  });

  it("renderPairSVG emits scatter circles and highlights divergences in red", () => {
    const out = renderPairSVG({
      kind: "pair",
      xVar: "a",
      yVar: "b",
      nChains: 2,
      x: [0, 1, 2, 3],
      y: [3, 2, 1, 0],
      chain: [0, 0, 1, 1],
      diverging: [false, false, false, true],
    });
    expect(countMatches(out, /<circle/g)).toBeGreaterThanOrEqual(4);
    expect(out).toContain("#d62728");
    expect(out).toContain("a vs b");
  });

  it("renderEnergySVG emits two overlaid curves with the E-BFMI in the title", () => {
    const out = renderEnergySVG({
      kind: "energy",
      edges: [-2, -1, 0, 1, 2],
      marginal: [1, 3, 4, 2],
      transition: [2, 4, 2, 1],
      bfmi: [0.4, 0.5],
    });
    expect(countMatches(out, /<path/g)).toBeGreaterThanOrEqual(2);
    expect(out).toContain("E-BFMI 0.45");
  });

  it("renderForestSVG emits a labeled row per variable", () => {
    const out = renderForestSVG({
      kind: "forest",
      hdiProb: 0.9,
      rows: [
        {
          variable: "alpha",
          mean: 1,
          hdi: [0, 2],
          iqr: [0.5, 1.5],
          rhat: 1,
          essBulk: 500,
          converged: true,
        },
      ],
    });
    expect(out).toContain(">alpha</text>");
    expect(out).toContain("<circle");
  });
});
