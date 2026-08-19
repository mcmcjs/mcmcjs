import { parseSamples } from "@mcmcjs/core";
import { describe, expect, it } from "vitest";
import { buildDiagnosticsReport, formatReportHuman, formatReportTable } from "../src/diagnose";

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

// Samples with a well-mixed variable "x" plus a constant integer column "z",
// the shape a fit produces when a recovered discrete latent is concentrated on
// one value.
function makeSamplesWithConstant(constantOnly = false) {
  const nChains = 4;
  const nDraws = 256;
  let s = 987654321 >>> 0;
  const vars = constantOnly ? ["z"] : ["x", "z"];
  // value_flat is indexed draw + param * nDraws + chain * nDraws * nParams.
  const valueFlat: number[] = new Array(nDraws * vars.length * nChains);
  for (let c = 0; c < nChains; c++) {
    for (let p = 0; p < vars.length; p++) {
      for (let i = 0; i < nDraws; i++) {
        s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
        valueFlat[i + p * nDraws + c * nDraws * vars.length] = vars[p] === "z" ? 2 : s / 4294967296;
      }
    }
  }
  return parseSamples({
    size: [nDraws, vars.length, nChains],
    value_flat: valueFlat,
    parameters: vars,
    name_map: { internals: [] },
  });
}

describe("buildDiagnosticsReport with constant variables", () => {
  it("treats a constant variable as neutral rather than as a failure", () => {
    const report = buildDiagnosticsReport(makeSamplesWithConstant());
    const z = report.variables.find((v) => v.variable === "z");
    const x = report.variables.find((v) => v.variable === "x");
    expect(Number.isFinite(z?.rhat ?? Number.NaN)).toBe(false);
    expect(x?.converged).toBe(true);
    expect(report.converged).toBe(true);
  });

  it("still fails when an informative variable does not converge", () => {
    const report = buildDiagnosticsReport(makeSamplesWithConstant(), {
      thresholds: { rhatMax: 1, essMin: 1e9 },
    });
    expect(report.converged).toBe(false);
  });

  it("fails when every variable is constant, since nothing sampled", () => {
    const report = buildDiagnosticsReport(makeSamplesWithConstant(true));
    expect(report.converged).toBe(false);
  });

  it("says the sampler never moved when nothing but constants came back", () => {
    const stuck = formatReportHuman(buildDiagnosticsReport(makeSamplesWithConstant(true)));
    expect(stuck).toContain("never moved from its starting point");
    // One constant beside a mixing variable is ordinary, not a stuck sampler.
    const mixed = formatReportHuman(buildDiagnosticsReport(makeSamplesWithConstant()));
    expect(mixed).not.toContain("never moved");
  });
});
