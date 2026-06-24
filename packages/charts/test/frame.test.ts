import { describe, expect, it } from "vitest";
import { axisFrame } from "../src/frame";

describe("axisFrame", () => {
  it("wraps body rows with a header, y-gutter labels, an axis, and x-labels", () => {
    const out = axisFrame(["aaa", "bbb", "ccc"], {
      width: 3,
      yMin: 0,
      yMax: 1,
      xLeft: "0",
      xRight: "9",
      charset: "ascii",
      header: "H",
      gutter: 4,
    });
    const lines = out.trimEnd().split("\n");
    // header + 3 body rows + axis + x-labels
    expect(lines).toHaveLength(6);
    expect(lines[0]).toBe("H");
    expect(lines[1]?.endsWith("|aaa")).toBe(true);
    expect(lines[1]).toContain("1"); // yMax label on the top row
    expect(lines[3]?.endsWith("|ccc")).toBe(true);
    expect(lines[3]).toContain("0"); // yMin label on the bottom row
    expect(lines[4]).toContain("+");
    expect(lines[4]).toContain("---");
    expect(lines[5]?.trimStart().startsWith("0")).toBe(true);
    expect(lines[5]?.endsWith("9")).toBe(true);
  });

  it("uses Unicode box glyphs for the unicode charset", () => {
    const out = axisFrame(["x"], {
      width: 1,
      yMin: 0,
      yMax: 1,
      xLeft: "0",
      xRight: "1",
      charset: "unicode",
    });
    expect(out).toContain("┤");
    expect(out).toContain("└");
    expect(out).toContain("─");
  });
});
