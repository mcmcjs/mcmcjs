import { describe, expect, it } from "vitest";
import { ticks } from "../src/ticks";

describe("ticks", () => {
  it("returns nice 1/2/5 steps spanning the range", () => {
    expect(ticks(0, 10, 5)).toEqual([0, 2, 4, 6, 8, 10]);
    expect(ticks(0, 100, 5)).toEqual([0, 20, 40, 60, 80, 100]);
  });

  it("handles a zero-width range and non-finite input", () => {
    expect(ticks(5, 5)).toEqual([5]);
    expect(ticks(Number.NaN, 1)).toEqual([]);
  });
});
