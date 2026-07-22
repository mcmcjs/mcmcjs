import type { Samples } from "@mcmcjs/core";
import { describe, expect, it } from "vitest";
import {
  bandwidthEss,
  contourThresholds,
  cornerData,
  defaultBins,
  filterScatter,
  groupRings,
  hexbin,
  histEdges,
  histPdf,
  marchingSquares,
  marginTitle,
  pointInRing,
  quantileT7,
} from "../src/corner";
import { htmlItemFor } from "../src/html";
import { renderCornerSVG } from "../src/svg";
import { renderCornerTerminal } from "../src/terminal";

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

/** Deterministic standard-normal-ish draws via a fixed linear congruential stream. */
function pseudoNormal(n: number, seed: number, shift = 0, scale = 1): number[] {
  let state = seed;
  const next = (): number => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
  return Array.from({ length: n }, () => {
    let sum = 0;
    for (let i = 0; i < 12; i++) sum += next();
    return (sum - 6) * scale + shift;
  });
}

const gaussianSamples = makeSamples({
  alpha: [pseudoNormal(400, 1, 0, 1), pseudoNormal(400, 7, 0, 1)],
  beta: [pseudoNormal(400, 3, 2, 0.5), pseudoNormal(400, 11, 2, 0.5)],
});

describe("contourThresholds", () => {
  it("encloses exp(-1/(2 sigma^2)) of the mass above the sigma threshold", () => {
    // Analytic standard-normal product density on a wide grid.
    const n = 161;
    const grid = Array.from({ length: n }, (_, i) => -4 + (8 * i) / (n - 1));
    const h = grid.map((x) => grid.map((y) => Math.exp(-0.5 * (x * x + y * y))));
    for (const sigma of [1, 2]) {
      const [threshold] = contourThresholds(h, [sigma]);
      let above = 0;
      let total = 0;
      for (const row of h) {
        for (const v of row) {
          total += v;
          if (v > (threshold as number)) above += v;
        }
      }
      expect(above / total).toBeCloseTo(Math.exp(-0.5 / sigma ** 2), 1);
    }
  });

  it("orders thresholds ascending for descending sigmas", () => {
    const n = 81;
    const grid = Array.from({ length: n }, (_, i) => -4 + (8 * i) / (n - 1));
    const h = grid.map((x) => grid.map((y) => Math.exp(-0.5 * (x * x + y * y))));
    const thresholds = contourThresholds(h, [0.5, 1, 1.5, 2]);
    expect(thresholds).toHaveLength(4);
    const sorted = [...thresholds].sort((a, b) => a - b);
    expect(thresholds).toEqual(sorted);
  });
});

describe("marchingSquares", () => {
  it("traces one closed ring around a radial peak", () => {
    const n = 41;
    const grid = Array.from({ length: n }, (_, i) => -2 + (4 * i) / (n - 1));
    const h = grid.map((x) => grid.map((y) => 1 - (x * x + y * y)));
    const rings = marchingSquares(grid, grid, h, 0.5);
    expect(rings).toHaveLength(1);
    const ring = rings[0] as { x: number[]; y: number[] };
    expect(ring.x[0]).toBeCloseTo(ring.x[ring.x.length - 1] as number, 9);
    expect(ring.y[0]).toBeCloseTo(ring.y[ring.y.length - 1] as number, 9);
    // 1 - r^2 = 0.5 => r = sqrt(0.5)
    for (let i = 0; i < ring.x.length; i++) {
      const r = Math.hypot(ring.x[i] as number, ring.y[i] as number);
      expect(r).toBeGreaterThan(0.65);
      expect(r).toBeLessThan(0.75);
    }
  });
});

describe("groupRings", () => {
  it("nests an annulus into an outer ring with a hole", () => {
    const n = 81;
    const grid = Array.from({ length: n }, (_, i) => -2 + (4 * i) / (n - 1));
    const h = grid.map((x) => grid.map((y) => Math.exp(-((Math.hypot(x, y) - 1) ** 2) / 0.05)));
    const rings = marchingSquares(grid, grid, h, 0.5);
    expect(rings).toHaveLength(2);
    const polygons = groupRings(rings);
    expect(polygons).toHaveLength(1);
    expect((polygons[0] as { rings: unknown[] }).rings).toHaveLength(2);
  });
});

describe("pointInRing and filterScatter", () => {
  const square = { x: [-1, 1, 1, -1, -1], y: [-1, -1, 1, 1, -1] };

  it("classifies inside and outside points", () => {
    expect(pointInRing(0, 0, square)).toBe(true);
    expect(pointInRing(2, 0, square)).toBe(false);
  });

  it("keeps only points outside the filter contour", () => {
    const x = Float64Array.from([0, 2, 0.5, -3]);
    const y = Float64Array.from([0, 0, 0.5, 0]);
    const kept = filterScatter(x, y, [square]);
    expect(kept.x).toEqual([2, -3]);
  });
});

describe("marginTitle", () => {
  it("formats asymmetric errors with error-driven digits", () => {
    expect(marginTitle(0.02, 5.014, 0.03)).toBe("5.014 -0.020/+0.030");
  });

  it("collapses equal rounded errors to a symmetric form", () => {
    expect(marginTitle(0.5, 1.25, 0.5)).toBe("1.3 ± 0.5");
  });

  it("switches to scientific notation for tiny errors", () => {
    expect(marginTitle(1e-6, 2e-6, 1e-6)).toBe("(2.0 ± 1.0) × 10^-6");
  });

  it("falls back to the midpoint scale when the errors are zero", () => {
    expect(marginTitle(0, 4, 0)).toBe("4");
  });
});

describe("bandwidth and bins", () => {
  it("uses unit width when the sample has no spread", () => {
    const data = Float64Array.from([2, 2, 2, 2]);
    expect(bandwidthEss(data, 4)).toBeCloseTo(0.9 * 1 * 4 ** -0.2, 12);
  });

  it("derives the ESS-driven bin count", () => {
    expect(defaultBins(1000)).toBe(Math.ceil(1.8 * Math.log2(1000)) + 1);
    expect(defaultBins(2)).toBe(7);
  });

  it("builds nice left-closed histogram edges", () => {
    const edges = histEdges(0, 1, 10);
    expect(edges[0]).toBe(0);
    expect(edges[1]).toBeCloseTo(0.1, 12);
    expect(edges[edges.length - 1] as number).toBeGreaterThan(1);
  });

  it("normalizes histogram weights to a pdf", () => {
    const data = Float64Array.from(pseudoNormal(500, 5));
    const { x, weights } = histPdf(data, 12);
    expect(x.length).toBe(weights.length);
    const width = (x[1] as number) - (x[0] as number);
    const mass = weights.reduce((a, b) => a + b, 0) * width;
    expect(mass).toBeCloseTo(1, 6);
  });

  it("computes type-7 quantiles", () => {
    const data = Float64Array.from([1, 2, 3, 4]);
    expect(quantileT7(data, 0.5)).toBeCloseTo(2.5, 12);
    expect(quantileT7(data, 0)).toBe(1);
    expect(quantileT7(data, 1)).toBe(4);
  });
});

describe("hexbin", () => {
  it("conserves the observation count across hexagons", () => {
    const x = Float64Array.from(pseudoNormal(300, 2));
    const y = Float64Array.from(pseudoNormal(300, 4));
    const bins = hexbin(x, y, 10, 10);
    expect(bins.weight.reduce((a, b) => a + b, 0)).toBe(300);
    expect(Math.max(...bins.weight)).toBe(bins.wmax);
    expect(bins.hexX).toBeGreaterThan(0);
    expect(bins.hexY).toBeGreaterThan(0);
  });
});

describe("cornerData", () => {
  it("applies the grayscale single-series tier", () => {
    const data = cornerData([{ samples: gaussianSamples }]);
    expect(data.vars).toEqual(["alpha", "beta"]);
    expect(data.series[0]?.color).toBe("rgba(0,0,0,0.5)");
    const cell = data.cells[0];
    expect(cell?.row).toBe(1);
    expect(cell?.col).toBe(0);
    const types = (cell?.layers ?? []).map((l) => l.type);
    expect(types).toContain("hexbin");
    expect(types).toContain("scatter");
    expect(types).toContain("contour");
    const diagTypes = (data.diags[0]?.layers ?? []).map((l) => l.type);
    expect(diagTypes).toEqual(
      expect.arrayContaining([
        "marginhist",
        "marginstephist",
        "margindensity",
        "marginquantilelines",
      ]),
    );
    expect(data.diags[0]?.titles.length).toBe(1);
    expect(data.diagonal).toBe(true);
  });

  it("cycles wong colors and switches to the overlay tier for two series", () => {
    const second = makeSamples({
      alpha: [pseudoNormal(400, 13, 1, 1), pseudoNormal(400, 17, 1, 1)],
      beta: [pseudoNormal(400, 19, 3, 0.5), pseudoNormal(400, 23, 3, 0.5)],
    });
    const data = cornerData([
      { samples: gaussianSamples, label: "posterior" },
      { samples: second, label: "prior" },
    ]);
    expect(data.series[0]?.color).toBe("#0072b2");
    expect(data.series[1]?.color).toBe("#e69f00");
    const types = (data.cells[0]?.layers ?? []).map((l) => l.type);
    expect(types).toContain("contourf");
    expect(types).not.toContain("hexbin");
    // Linked domains cover both series.
    const [lo, hi] = data.domains[1] as [number, number];
    expect(lo).toBeLessThan(1.2);
    expect(hi).toBeGreaterThan(2.8);
  });

  it("adds truth lines to body, diagonal, and titles", () => {
    const data = cornerData([{ samples: gaussianSamples }], {
      truth: [{ values: { alpha: 0, beta: 2 } }],
    });
    const bodyTypes = (data.cells[0]?.layers ?? []).map((l) => l.type);
    expect(bodyTypes).toContain("bodylines");
    const diagTypes = (data.diags[0]?.layers ?? []).map((l) => l.type);
    expect(diagTypes).toContain("marginlines");
    expect(data.diags[0]?.titles.some((t) => t.text === "0")).toBe(true);
  });

  it("filters the scatter inside the filtersigma contour", () => {
    const data = cornerData([{ samples: gaussianSamples }]);
    const scatter = data.cells[0]?.layers.find((l) => l.type === "scatter");
    expect(scatter && scatter.type === "scatter" && scatter.x.length).toBeLessThan(800);
    expect(scatter && scatter.type === "scatter" && scatter.x.length).toBeGreaterThan(0);
  });
});

describe("corner renderers", () => {
  const single = cornerData([{ samples: gaussianSamples }]);

  it("renders the SVG grid with clipped cells and quantile titles", () => {
    const svg = renderCornerSVG(single);
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain("corner-clip-");
    expect(svg).toContain("alpha");
    expect(svg).toContain("±");
  });

  it("renders filled contours with the evenodd rule for multi-series data", () => {
    const second = makeSamples({
      alpha: [pseudoNormal(400, 29, 1, 1), pseudoNormal(400, 31, 1, 1)],
      beta: [pseudoNormal(400, 37, 3, 0.5), pseudoNormal(400, 41, 3, 0.5)],
    });
    const svg = renderCornerSVG(
      cornerData([{ samples: gaussianSamples }, { samples: second, label: "prior" }]),
    );
    expect(svg).toContain('fill-rule="evenodd"');
    expect(svg).toContain("prior");
  });

  it("summarizes the diagonal in the terminal", () => {
    const text = renderCornerTerminal(single);
    expect(text).toContain("corner (2 vars, 1 series)");
    expect(text).toContain("alpha");
  });

  it("embeds as SVG in the HTML document path", () => {
    const item = htmlItemFor(single);
    expect(item.mode).toBe("svg");
    expect(item.mode === "svg" && item.svg.startsWith("<svg")).toBe(true);
  });
});
