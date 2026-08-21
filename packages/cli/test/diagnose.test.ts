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

// Samples with a well-mixed variable "x" plus an integer column "z", the shape a
// fit produces when a recovered discrete latent concentrates on one value. With
// `stray`, one draw of z in one chain differs, which is what a real recovered
// latent usually looks like: the pooled column varies, yet R-hat and ESS stay
// undefined because some chain never moved.
function makeSamplesWithConstant(constantOnly = false, stray = false) {
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
        const z = stray && c === 0 && i === 7 ? 1 : 2;
        valueFlat[i + p * nDraws + c * nDraws * vars.length] = vars[p] === "z" ? z : s / 4294967296;
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

/** Two chains of one variable whose draws are all null, i.e. NaN once parsed. */
function makeUnusableSamples() {
  return parseSamples({
    size: [4, 1, 2],
    value_flat: [null, null, null, null, null, null, null, null],
    parameters: ["x"],
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

  it("treats a latent that moves once in one chain as neutral too", () => {
    const report = buildDiagnosticsReport(makeSamplesWithConstant(false, true));
    const z = report.variables.find((v) => v.variable === "z");
    // The pooled column varies, so a std-of-zero test would miss it, but R-hat is
    // undefined all the same because the other chains never moved.
    expect(z?.std).toBeGreaterThan(0);
    expect(Number.isFinite(z?.rhat ?? Number.NaN)).toBe(false);
    expect(report.converged).toBe(true);
  });

  it("fails on a variable whose draws are unusable, not just undiagnosable", () => {
    const report = buildDiagnosticsReport(makeUnusableSamples());
    // NaN draws leave R-hat undefined too, but they poison the mean, which is how
    // corruption is told apart from a variable that simply does not move.
    expect(Number.isFinite(report.variables[0]?.mean ?? 0)).toBe(false);
    expect(report.converged).toBe(false);
  });

  it("fails when every variable is constant, since nothing sampled", () => {
    const report = buildDiagnosticsReport(makeSamplesWithConstant(true));
    expect(report.converged).toBe(false);
  });

  it("says nothing was testable when no variable varies in every chain", () => {
    const stuck = formatReportHuman(buildDiagnosticsReport(makeSamplesWithConstant(true)));
    expect(stuck).toContain("nothing was testable");
    // One such variable beside a mixing one is ordinary, not a stuck sampler.
    const mixed = formatReportHuman(buildDiagnosticsReport(makeSamplesWithConstant()));
    expect(mixed).not.toContain("nothing was testable");
  });
});

/** One well-mixed chain: R-hat needs two, so the table is all n/a. */
function makeSingleChainSamples(nDraws = 256) {
  let s = 24681357 >>> 0;
  const valueFlat = Array.from({ length: nDraws }, () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  });
  return parseSamples({
    size: [nDraws, 1, 1],
    value_flat: valueFlat,
    parameters: ["x"],
    name_map: { internals: [] },
  });
}

// A lone chain leaves R-hat and ESS undefined for a reason that has nothing to
// do with the sampler: it moved fine, there is just nothing to compare it to.
describe("buildDiagnosticsReport with a single chain", () => {
  it("does not call a well-mixed lone chain degenerate", () => {
    const report = buildDiagnosticsReport(makeSingleChainSamples());
    const x = report.variables[0];
    expect(x?.varies).toBe(true);
    expect(Number.isFinite(x?.rhat ?? Number.NaN)).toBe(false);
    expect(x?.converged).toBe(false);
    expect(report.converged).toBe(false);
  });

  it("records the chain count it diagnosed", () => {
    expect(buildDiagnosticsReport(makeSingleChainSamples()).chains).toBe(1);
    expect(buildDiagnosticsReport(makeSamplesWithConstant()).chains).toBe(4);
  });

  it("blames the chain count, not the sampler", () => {
    const out = formatReportHuman(buildDiagnosticsReport(makeSingleChainSamples()));
    expect(out).toContain("--chains 2 or more");
    // The stuck-sampler note would be a lie here: the chain moved.
    expect(out).not.toContain("nothing was testable");
  });

  it("still names a stuck sampler when the lone chain never moved", () => {
    const stuck = parseSamples({
      size: [8, 1, 1],
      value_flat: [5, 5, 5, 5, 5, 5, 5, 5],
      parameters: ["z"],
      name_map: { internals: [] },
    });
    const out = formatReportHuman(buildDiagnosticsReport(stuck));
    expect(out).toContain("nothing was testable");
    expect(out).not.toContain("--chains 2 or more");
  });

  it("leaves a healthy multi-chain run with neither note", () => {
    const out = formatReportHuman(buildDiagnosticsReport(makeSamplesWithConstant()));
    expect(out).not.toContain("nothing was testable");
    expect(out).not.toContain("--chains 2 or more");
  });
});
