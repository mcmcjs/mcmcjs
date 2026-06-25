import { parseSamples } from "@mcmcjs/core";
import { describe, expect, it } from "vitest";
import { buildSummaryRows, formatSummaryTable } from "../src/summary";

// A deterministic 4-chain x 64-draw samples object with variables "x" and "y".
function makeSamples() {
  const nChains = 4;
  const nDraws = 64;
  const nParams = 2;
  let s = 24680 >>> 0;
  const flat = new Array<number>(nChains * nDraws * nParams);
  for (let c = 0; c < nChains; c++) {
    for (let i = 0; i < nDraws; i++) {
      for (let p = 0; p < nParams; p++) {
        s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
        flat[i + p * nDraws + c * nDraws * nParams] = s / 4294967296;
      }
    }
  }
  return parseSamples({
    size: [nDraws, nParams, nChains],
    value_flat: flat,
    parameters: ["x", "y"],
    name_map: { internals: [] },
  });
}

describe("buildSummaryRows", () => {
  it("returns one row per variable with finite stats", () => {
    const rows = buildSummaryRows(makeSamples());
    expect(rows.map((r) => r.variable)).toEqual(["x", "y"]);
    const x = rows[0];
    expect(Number.isFinite(x?.mean ?? Number.NaN)).toBe(true);
    expect(Number.isFinite(x?.ess_bulk ?? Number.NaN)).toBe(true);
    expect((x?.hdi[0] ?? 0) < (x?.hdi[1] ?? 0)).toBe(true);
  });

  it("filters to the requested variables", () => {
    const rows = buildSummaryRows(makeSamples(), ["y"]);
    expect(rows.map((r) => r.variable)).toEqual(["y"]);
  });
});

describe("formatSummaryTable", () => {
  it("renders a header and a row per variable", () => {
    const table = formatSummaryTable(buildSummaryRows(makeSamples()));
    expect(table).toContain("variable");
    expect(table).toContain("ess_bulk");
    expect(table).toContain("r_hat");
    expect(table).toContain("x");
    expect(table).toContain("y");
  });
});
