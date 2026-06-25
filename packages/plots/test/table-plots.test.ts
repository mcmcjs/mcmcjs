import type { Samples } from "@mcmcjs/core";
import { describe, expect, it } from "vitest";
import { diagnosticsHeatmapData, summaryTableData } from "../src/data";
import { renderDiagnosticsHeatmapSVG, renderSummaryTableSVG } from "../src/svg";
import { renderDiagnosticsHeatmapTerminal, renderSummaryTableTerminal } from "../src/terminal";

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

// Golden fixture: 2 chains x 24 draws of `mu` (matches the parity golden vectors).
const chain1 = [
  -0.9591946285, -1.4465016178, -0.6369392199, -0.0486614978, 0.7957282786, -0.3772125224,
  -0.1968274507, -0.0017160368, 0.1913422158, 0.66257194, -0.5890053951, 0.1930997473, 1.0281686088,
  -0.3385806138, 0.229923552, 0.0355501245, -0.189257907, 0.8244136203, 0.2244574122, 1.0177570191,
  1.496235176, 1.0755187227, 0.3835505196, 0.1916245276,
];
const chain2 = [
  0.3940045011, -0.3386300733, 0.3089707781, 0.7223824374, 1.0678256658, 1.1090608022, 0.6002250029,
  -0.0206651172, -0.5039611927, 0.4180686609, -0.1789823413, 0.3320493435, 0.7625485118,
  1.0983085377, -0.0908128588, 0.5436444844, 0.1162317882, -0.2702313459, -0.4526671339,
  -0.6997442287, -0.3594104146, 0.9532199656, 0.6221592998, 0.6600678389,
];
const samples = makeSamples({ mu: [chain1, chain2] });

describe("summaryTableData", () => {
  it("reproduces the golden summary row", () => {
    const d = summaryTableData(samples);
    expect(d.kind).toBe("summary-table");
    expect(d.rows).toHaveLength(1);
    const r = d.rows[0];
    if (!r) throw new Error("missing row");
    expect(r.variable).toBe("mu");
    expect(r.mean).toBeCloseTo(0.21582724, 6);
    expect(r.std).toBeCloseTo(0.62548594, 6);
    expect(r.mcse).toBeCloseTo(0.1331505, 6);
    expect(r.ess).toBeCloseTo(34.313502, 4);
    expect(r.essBulk).toBeCloseTo(20.516685, 4);
    expect(r.essTail).toBeCloseTo(31.085197, 4);
    expect(r.rhat).toBeCloseTo(1.0879011, 6);
    expect(r.splitRhat).toBeCloseTo(1.0834101, 6);
    expect(r.gewekeZ).toBeCloseTo(-3.707747, 5);
    expect(r.q5).toBeCloseTo(-0.67776248, 6);
    expect(r.q25).toBeCloseTo(-0.21517842, 6);
    expect(r.q50).toBeCloseTo(0.20877858, 6);
    expect(r.q75).toBeCloseTo(0.67752456, 6);
    expect(r.q95).toBeCloseTo(1.0903321, 6);
    expect(r.hdi90[0]).toBeCloseTo(-0.63693922, 6);
    expect(r.hdi90[1]).toBeCloseTo(1.1090608, 6);
  });
});

describe("diagnosticsHeatmapData", () => {
  it("reproduces the golden cell scores and ramp colors", () => {
    const d = diagnosticsHeatmapData(samples);
    expect(d.kind).toBe("diagnostics-heatmap");
    expect(d.metrics).toEqual([
      "R-hat",
      "Split R-hat",
      "ESS / draw",
      "Bulk ESS",
      "Tail ESS",
      "MCSE / sd",
      "|Geweke z|",
    ]);
    const cells = d.rows[0]?.cells;
    if (!cells) throw new Error("missing cells");

    const rhat = cells[0];
    expect(rhat?.score).toBeCloseTo(0.86556789, 6);
    expect(rhat?.rgb).toEqual([184, 43, 23]);
    expect(rhat?.text).toBe("1.088");

    const splitRhat = cells[1];
    expect(splitRhat?.score).toBeCloseTo(0.8156683, 6);
    expect(splitRhat?.rgb).toEqual([183, 48, 21]);
    expect(splitRhat?.text).toBe("1.083");

    const essPerDraw = cells[2];
    expect(essPerDraw?.score).toBe(0);
    expect(essPerDraw?.rgb).toEqual([21, 128, 61]);
    expect(essPerDraw?.text).toBe("0.715");

    const bulk = cells[3];
    expect(bulk?.score).toBe(1);
    expect(bulk?.rgb).toEqual([185, 28, 28]);
    expect(bulk?.text).toBe("21");

    const tail = cells[4];
    expect(tail?.score).toBe(1);
    expect(tail?.rgb).toEqual([185, 28, 28]);
    expect(tail?.text).toBe("31");

    const mcse = cells[5];
    expect(mcse?.score).toBe(1);
    expect(mcse?.rgb).toEqual([185, 28, 28]);
    expect(mcse?.text).toBe("0.213");

    const geweke = cells[6];
    expect(geweke?.score).toBe(1);
    expect(geweke?.rgb).toEqual([185, 28, 28]);
    expect(geweke?.text).toBe("3.708");
  });

  it("uses a neutral amber midpoint for an undefined metric", () => {
    // A single short chain leaves Geweke undefined (n < 20) -> score 0.5.
    const short = makeSamples({ mu: [[1, 2, 3, 4, 5, 6, 7, 8, 9, 10]] });
    const d = diagnosticsHeatmapData(short);
    const geweke = d.rows[0]?.cells[6];
    expect(geweke?.score).toBe(0.5);
    expect(geweke?.rgb).toEqual([180, 83, 9]);
    expect(geweke?.text).toBe("—");
  });
});

describe("table renderers", () => {
  it("summary-table terminal lists the parameter and rounded ESS", () => {
    const out = renderSummaryTableTerminal(summaryTableData(samples));
    expect(out).toContain("mu");
    expect(out).toContain("0.2158");
    expect(out).toContain("[-0.637, 1.109]");
  });

  it("summary-table SVG is a self-contained svg with the variable label", () => {
    const out = renderSummaryTableSVG(summaryTableData(samples));
    expect(out.startsWith("<svg")).toBe(true);
    expect(out).toContain(">mu</text>");
  });

  it("diagnostics-heatmap SVG fills cells with the golden ramp colors", () => {
    const out = renderDiagnosticsHeatmapSVG(diagnosticsHeatmapData(samples));
    expect(out).toContain("rgb(184,43,23)"); // R-hat
    expect(out).toContain("rgb(185,28,28)"); // Bulk ESS
    expect(out).toContain("rgb(21,128,61)"); // ESS / draw
  });

  it("diagnostics-heatmap terminal prints the metric header and cell text", () => {
    const out = renderDiagnosticsHeatmapTerminal(diagnosticsHeatmapData(samples));
    expect(out).toContain("R-hat");
    expect(out).toContain("|Geweke z|");
    expect(out).toContain("1.088");
  });
});
