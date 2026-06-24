import { describe, expect, it } from "vitest";
import { renderForestTerminal, renderTraceTerminal } from "../src/terminal";
import type { ForestData, TraceData } from "../src/types";

const trace: TraceData = {
  kind: "trace",
  variable: "mu",
  nChains: 2,
  nDraws: 5,
  chains: [
    [1, 2, 3, 4, 5],
    [5, 4, 3, 2, 1],
  ],
  rhat: 1.004,
  essBulk: 321,
};

const hasBraille = (s: string): boolean => [...s].some((ch) => ch.charCodeAt(0) >= 0x2800);

describe("renderTraceTerminal", () => {
  it("renders a header with the variable, R-hat, ESS, and chain/draw counts", () => {
    const out = renderTraceTerminal(trace, { height: 4 });
    expect(out.startsWith("mu   R-hat 1.004   ESS 321   (2 chains x 5 draws)")).toBe(true);
    // header + 4 plot rows + axis + x-labels
    expect(out.trimEnd().split("\n")).toHaveLength(7);
    // the x-axis ends at the final draw index
    expect(out.trimEnd().endsWith("5")).toBe(true);
  });

  it("uses braille glyphs by default and plain ASCII markers with charset ascii", () => {
    expect(hasBraille(renderTraceTerminal(trace, { height: 4 }))).toBe(true);
    const ascii = renderTraceTerminal(trace, { height: 4, charset: "ascii" });
    expect(hasBraille(ascii)).toBe(false);
    expect(ascii).toMatch(/[o+x*#@]/);
  });

  it("applies the per-chain color hook", () => {
    const out = renderTraceTerminal(trace, {
      height: 4,
      charset: "ascii",
      color: (text, chain) => `<${chain}:${text}>`,
    });
    expect(out).toContain("<0:");
    expect(out).toContain("<1:");
  });

  it("reports n/a for undefined diagnostics", () => {
    const out = renderTraceTerminal({ ...trace, rhat: Number.NaN, essBulk: Number.NaN });
    expect(out).toContain("R-hat n/a");
    expect(out).toContain("ESS n/a");
  });
});

const forest: ForestData = {
  kind: "forest",
  hdiProb: 0.9,
  rows: [
    {
      variable: "a",
      mean: 1,
      hdi: [0, 2],
      iqr: [0.5, 1.5],
      rhat: 1.0,
      essBulk: 500,
      converged: true,
    },
    { variable: "b", mean: 5, hdi: [3, 7], iqr: [4, 6], rhat: 1.2, essBulk: 40, converged: false },
  ],
};

describe("renderForestTerminal", () => {
  it("renders a row per variable with the mean, HDI, and R-hat", () => {
    const out = renderForestTerminal(forest);
    expect(out).toContain("parameter");
    expect(out).toContain("90% HDI");
    expect(out).toContain("a");
    expect(out).toContain("b");
    expect(out).toContain("[3, 7]");
  });

  it("marks a non-converged row via the warn hook", () => {
    const out = renderForestTerminal(forest, { warn: (t) => `[${t}]` });
    expect(out).toContain("[1.200!]");
    expect(out).not.toContain("[1.000!]");
  });

  it("handles an empty plot", () => {
    expect(renderForestTerminal({ kind: "forest", hdiProb: 0.9, rows: [] })).toBe(
      "(no variables)\n",
    );
  });
});
