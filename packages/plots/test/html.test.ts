import { describe, expect, it } from "vitest";
import { buildHtmlDocument } from "../src/html/document";
import { UPLOT_JS } from "../src/html/uplot-assets.generated";
import { htmlItemFor, type PlotData } from "../src/html/uplot-spec";

const trace: PlotData = {
  kind: "trace",
  variable: "mu",
  nChains: 2,
  nDraws: 4,
  chains: [
    [1, 2, 3, 4],
    [4, 3, 2, 1],
  ],
  rhat: 1.01,
  essBulk: 320,
};

const histogram: PlotData = {
  kind: "histogram",
  variable: "mu",
  binEdges: [0, 1, 2, 3],
  counts: [2, 5, 1],
  total: 8,
};

const rank: PlotData = {
  kind: "rank",
  variable: "mu",
  nChains: 2,
  bins: 3,
  counts: [
    [1, 2, 3],
    [3, 2, 1],
  ],
  expected: 2,
};

const forest: PlotData = {
  kind: "forest",
  hdiProb: 0.9,
  rows: [
    {
      variable: "a",
      mean: 1,
      hdi: [0, 2],
      iqr: [0.5, 1.5],
      rhat: 1,
      essBulk: 500,
      converged: true,
    },
  ],
};

describe("htmlItemFor", () => {
  it("maps uPlot-friendly kinds to a function-free spec", () => {
    const item = htmlItemFor(trace);
    expect(item.mode).toBe("uplot");
    if (item.mode !== "uplot") throw new Error("expected uplot");
    // data[0] is the shared x, one row per chain follows.
    expect(item.spec.data).toHaveLength(3);
    expect(item.spec.data[0]).toEqual([0, 1, 2, 3]);
    expect(item.spec.series).toHaveLength(2);
    expect(JSON.stringify(item.spec)).not.toContain("function");
  });

  it("flags bar and stepped path styles instead of embedding functions", () => {
    const hist = htmlItemFor(histogram);
    const rnk = htmlItemFor(rank);
    if (hist.mode !== "uplot" || rnk.mode !== "uplot") throw new Error("expected uplot");
    expect(hist.spec.series[0]?.paths).toBe("bars");
    expect(rnk.spec.series[0]?.paths).toBe("stepped");
  });

  it("keeps reference guides in a tagged refLines channel, not in the data series", () => {
    const rnk = htmlItemFor(rank);
    if (rnk.mode !== "uplot") throw new Error("expected uplot");
    // Every data series is a real chain; the uniform expectation is a refLine.
    expect(rnk.spec.series).toHaveLength(2);
    expect(rnk.spec.series.every((s) => s.role === "chain")).toBe(true);
    expect(rnk.spec.refLines?.[0]).toMatchObject({ value: 2, label: "uniform" });

    const rr = htmlItemFor({
      kind: "running-rhat",
      variable: "mu",
      nChains: 2,
      iterations: [10, 20, 30],
      rhat: [1.2, 1.05, 1.0],
    });
    if (rr.mode !== "uplot") throw new Error("expected uplot");
    // Only the R-hat line is a data series; 1.00 and 1.05 are guide lines.
    expect(rr.spec.series).toHaveLength(1);
    expect(rr.spec.refLines?.map((r) => r.value)).toEqual([1, 1.05]);
  });

  it("keys chain color and label to chain identity when chainIds are present", () => {
    const subset = htmlItemFor({ ...trace, chainIds: [0, 3] } as PlotData);
    if (subset.mode !== "uplot") throw new Error("expected uplot");
    expect(subset.spec.series.map((s) => s.label)).toEqual(["chain 1", "chain 4"]);
    // The second series inherits chain 3's palette slot, not position 1's.
    const positional = htmlItemFor(trace);
    if (positional.mode !== "uplot") throw new Error("expected uplot");
    expect(subset.spec.series[1]?.stroke).not.toBe(positional.spec.series[1]?.stroke);
  });

  it("renders forest and pair as embedded SVG", () => {
    const item = htmlItemFor(forest);
    expect(item.mode).toBe("svg");
    if (item.mode !== "svg") throw new Error("expected svg");
    expect(item.svg.startsWith("<svg")).toBe(true);
  });
});

describe("buildHtmlDocument", () => {
  it("produces a self-contained document with inlined uPlot and embedded data", () => {
    const html = buildHtmlDocument([trace, histogram], { title: "run X" });
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("<title>run X</title>");
    // uPlot bundle inlined, no external resource references.
    expect(html).toContain(UPLOT_JS.slice(0, 40));
    expect(html).not.toMatch(/<script[^>]+\bsrc=/);
    expect(html).not.toMatch(/<link[^>]+stylesheet/);
    // The embedded JSON round-trips to the two items.
    const m = html.match(/<script type="application\/json"[^>]*>([\s\S]*?)<\/script>/);
    expect(m).not.toBeNull();
    const data = JSON.parse((m?.[1] ?? "").replace(/\\u003c/g, "<"));
    expect(data.items).toHaveLength(2);
  });

  it("escapes the title and never lets data break out of the data script", () => {
    const evil: PlotData = { ...trace, variable: "</script><img>" };
    const html = buildHtmlDocument([evil], { title: "<b>x</b>" });
    expect(html).toContain("&lt;b&gt;x&lt;/b&gt;");
    expect(html).not.toContain("</script><img>");
  });
});
