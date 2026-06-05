import { parseSamples } from "@mcmcjs/core";
import { describe, expect, it } from "vitest";
import { buildDiagnosticsReport, formatReportTable } from "./diagnose";

// A deterministic 4-chain x 64-draw, single-variable ("x") samples object.
function makeSamples() {
  const nChains = 4;
  const nDraws = 64;
  let s = 12345 >>> 0;
  const valueFlat: number[] = new Array(nChains * nDraws);
  for (let c = 0; c < nChains; c++) {
    for (let i = 0; i < nDraws; i++) {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      valueFlat[i + c * nDraws] = s / 4294967296;
    }
  }
  return parseSamples({
    size: [nDraws, 1, nChains],
    value_flat: valueFlat,
    parameters: ["x"],
    name_map: { internals: [] },
  });
}

describe("buildDiagnosticsReport", () => {
  it("reports finite diagnostics per variable with an overall verdict", () => {
    const report = buildDiagnosticsReport(makeSamples());
    expect(report.variables).toHaveLength(1);
    const v = report.variables[0];
    expect(v?.variable).toBe("x");
    expect(Number.isFinite(v?.rhat ?? Number.NaN)).toBe(true);
    expect(Number.isFinite(v?.essBulk ?? Number.NaN)).toBe(true);
    expect((v?.hdi[0] ?? 0) < (v?.hdi[1] ?? 0)).toBe(true);
    expect(report.converged).toBe(v?.converged);
  });

  it("honors custom thresholds", () => {
    const report = buildDiagnosticsReport(makeSamples(), {
      thresholds: { rhatMax: 1, essMin: 1e9 },
    });
    expect(report.converged).toBe(false);
  });
});

describe("formatReportTable", () => {
  it("renders a header and a row per variable", () => {
    const table = formatReportTable(buildDiagnosticsReport(makeSamples()), false);
    expect(table).toContain("variable");
    expect(table).toContain("r_hat");
    expect(table).toContain("x");
  });
});
