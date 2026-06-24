import { describe, expect, it } from "vitest";
import { DotCanvas } from "../src/canvas";

const plain = (t: string): string => t;

describe("DotCanvas", () => {
  it("sets a dot and renders the matching braille glyph", () => {
    const c = new DotCanvas(1, 1); // one cell = 2x4 dots
    c.set(0, 0, 0); // top-left dot -> bit 0x01 -> U+2801
    expect(c.rows("unicode", plain)).toEqual(["⠁"]);
  });

  it("leaves untouched cells blank", () => {
    const c = new DotCanvas(2, 1);
    c.set(0, 0, 0);
    expect(c.rows("unicode", plain)[0]?.[1]).toBe(" ");
  });

  it("renders an ASCII marker per series and applies the color hook", () => {
    const c = new DotCanvas(1, 1);
    c.set(0, 0, 1); // series 1 -> ASCII_MARKERS[1] = "+"
    expect(c.rows("ascii", (t, s) => `<${s}:${t}>`)).toEqual(["<1:+>"]);
  });

  it("draws a connected line across cells", () => {
    const c = new DotCanvas(4, 1); // 8 dots wide
    c.line(0, 0, 7, 0, 0);
    const row = c.rows("unicode", plain)[0] ?? "";
    expect([...row].every((ch) => ch !== " ")).toBe(true);
  });

  it("ignores out-of-bounds points", () => {
    const c = new DotCanvas(1, 1);
    c.set(-1, 0, 0);
    c.set(0, 99, 0);
    expect(c.rows("unicode", plain)).toEqual([" "]);
  });
});
