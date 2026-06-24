import { describe, expect, it } from "vitest";
import { seriesColor, stackSvg, svgFrame, svgPolyline } from "../src/svg";

describe("svgFrame", () => {
  it("renders a standalone svg with a title and maps data to pixels", () => {
    const f = svgFrame({ width: 200, height: 100, xDomain: [0, 10], yDomain: [0, 1], title: "t" });
    const out = f.render(
      svgPolyline(
        [
          [f.x.map(0), f.y.map(0)],
          [f.x.map(10), f.y.map(1)],
        ],
        "#000",
      ),
    );
    expect(out.startsWith("<svg")).toBe(true);
    expect(out).toContain("</svg>");
    expect(out).toContain("<path");
    expect(out).toContain(">t</text>");
    expect(f.x.map(0)).toBeLessThan(f.x.map(10));
    // SVG y grows downward, so the domain min sits below the max.
    expect(f.y.map(0)).toBeGreaterThan(f.y.map(1));
  });

  it("renders categorical row labels instead of numeric ticks", () => {
    const f = svgFrame({
      width: 200,
      height: 120,
      xDomain: [0, 1],
      yDomain: [2, 0],
      yLabels: ["a", "b"],
    });
    const out = f.render("");
    expect(out).toContain(">a</text>");
    expect(out).toContain(">b</text>");
  });
});

describe("seriesColor", () => {
  it("cycles the palette", () => {
    expect(seriesColor(0)).toBe(seriesColor(7));
    expect(seriesColor(0)).not.toBe(seriesColor(1));
  });
});

describe("stackSvg", () => {
  it("nests several svgs vertically at increasing offsets", () => {
    const one = svgFrame({ width: 100, height: 50, xDomain: [0, 1], yDomain: [0, 1] }).render("");
    const out = stackSvg([one, one]);
    expect(out).toContain('height="100"');
    expect(out).toContain('y="50"');
  });

  it("returns a single svg unchanged", () => {
    const one = svgFrame({ width: 100, height: 50, xDomain: [0, 1], yDomain: [0, 1] }).render("");
    expect(stackSvg([one])).toBe(one);
  });
});
