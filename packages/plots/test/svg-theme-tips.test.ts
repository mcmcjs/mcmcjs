import type { Samples } from "@mcmcjs/core";
import { describe, expect, it } from "vitest";
import { cornerData } from "../src/corner";
import {
  chainIntervalsData,
  forestData,
  pairData,
  parallelCoordsData,
  splomData,
  traceData,
  violinData,
} from "../src/data";
import { buildHtmlDocument } from "../src/html";
import {
  renderChainIntervalsSVG,
  renderCornerSVG,
  renderForestSVG,
  renderPairSVG,
  renderParallelCoordsSVG,
  renderSplomSVG,
  renderTraceSVG,
  renderViolinSVG,
} from "../src/svg";

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
  alpha: [
    [1, 2, 3, 4, 5, 6, 5, 4],
    [2, 3, 4, 5, 6, 7, 6, 5],
  ],
  beta: [
    [0.4, 0.5, 0.6, 0.5, 0.4, 0.5, 0.6, 0.5],
    [0.5, 0.6, 0.7, 0.6, 0.5, 0.6, 0.7, 0.6],
  ],
});

describe("SVG renderers carry data-tip marks", () => {
  it("pair points name both variables and the chain", () => {
    const svg = renderPairSVG(pairData(samples, "alpha", "beta"));
    expect(svg).toContain('data-tip="alpha ');
    expect(svg).toContain("chain 1");
  });

  it("forest rows summarize mean, HDI, and R-hat", () => {
    const svg = renderForestSVG(forestData(samples));
    expect(svg).toMatch(/data-tip="alpha {2}mean [^"]*HDI \[[^"]*R-hat/);
  });

  it("violin, intervals, splom, parallel-coords, trace, and corner are tipped", () => {
    expect(renderViolinSVG(violinData(samples, "alpha"))).toContain("data-tip=");
    expect(renderChainIntervalsSVG(chainIntervalsData(samples, "alpha"))).toContain("data-tip=");
    const splom = renderSplomSVG(splomData(samples));
    expect(splom).toContain("Pearson r ");
    expect(splom).toContain("data-tip=");
    expect(renderParallelCoordsSVG(parallelCoordsData(samples))).toContain('data-tip="chain ');
    expect(renderTraceSVG(traceData(samples, "alpha"))).toContain('data-tip="chain 1"');
    const corner = renderCornerSVG(cornerData([{ samples }]));
    expect(corner).toContain('data-tip="n = ');
    expect(corner).toMatch(/data-tip="[0-9.]+σ"/);
  });
});

describe("SVG renderers use theme tokens", () => {
  it("draws background, text, and frames through --mcmc variables", () => {
    const svg = renderForestSVG(forestData(samples));
    expect(svg).toContain("var(--mcmc-bg,#ffffff)");
    expect(svg).toContain("var(--mcmc-fg,");
    const corner = renderCornerSVG(cornerData([{ samples }]));
    expect(corner).toContain("var(--mcmc-grid,");
  });
});

describe("HTML export wiring", () => {
  it("ships theme tokens, hover CSS, and the inlined tips runtime", () => {
    const html = buildHtmlDocument([forestData(samples), traceData(samples, "alpha")]);
    expect(html).toContain("--mcmc-bg: #171a21");
    expect(html).toContain("svg [data-tip]:hover");
    expect(html).toContain("__mcmcAttachSvgTips");
    expect(html).toContain("prefers-color-scheme: dark");
    expect(html).toContain("--mcmc-axis");
  });
});
