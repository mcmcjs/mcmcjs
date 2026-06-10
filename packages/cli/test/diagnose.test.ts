import { parseSamples } from "@mcmcjs/core";
import { describe, expect, it } from "vitest";
import { buildDiagnosticsReport, formatReportTable } from "../src/diagnose";

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

// A 2-chain x 50-draw samples object with variable "x" and a numerical_error
// internal carrying `divergences` divergent draws.
function makeSamplesWithDivergences(divergences: number) {
  const nChains = 2;
  const nDraws = 50;
  const nParams = 2;
  let s = 999 >>> 0;
  const total = nChains * nDraws;
  const x = new Array<number>(total);
  for (let i = 0; i < total; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    x[i] = s / 4294967296;
  }
  const flat = new Array<number>(total * nParams);
  for (let c = 0; c < nChains; c++) {
    for (let i = 0; i < nDraws; i++) {
      const k = c * nDraws + i;
      flat[i + 0 * nDraws + c * nDraws * nParams] = x[k] as number;
      flat[i + 1 * nDraws + c * nDraws * nParams] = k < divergences ? 1 : 0;
    }
  }
  return parseSamples({
    size: [nDraws, nParams, nChains],
    value_flat: flat,
    parameters: ["x", "numerical_error"],
    name_map: { parameters: ["x"], internals: ["numerical_error"] },
  });
}

describe("divergences", () => {
  const loose = { rhatMax: 2, essMin: 1 };

  it("reports the count and fails the verdict when above the threshold", () => {
    const report = buildDiagnosticsReport(makeSamplesWithDivergences(3), { thresholds: loose });
    expect(report.divergences).toBe(3);
    expect(report.converged).toBe(false);
  });

  it("passes when divergences are within the allowed maximum", () => {
    const report = buildDiagnosticsReport(makeSamplesWithDivergences(3), {
      thresholds: loose,
      maxDivergences: 3,
    });
    expect(report.divergences).toBe(3);
    expect(report.converged).toBe(true);
  });

  it("reports null when the samples carry no divergence stat", () => {
    expect(buildDiagnosticsReport(makeSamples(), { thresholds: loose }).divergences).toBeNull();
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
