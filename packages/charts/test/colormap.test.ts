import { describe, expect, it } from "vitest";
import {
  VIRIDIS_STOPS,
  viridisCss,
  viridisHex,
  viridisRgb,
  WONG_COLORS,
  wongColor,
} from "../src/colormap";

// Golden vectors produced by running the reference viridisRgb verbatim in Node.
describe("viridisRgb", () => {
  it("hits the documented stops and interpolates between them", () => {
    expect(viridisRgb(0)).toEqual([68, 1, 84]);
    expect(viridisRgb(1 / 15)).toEqual([70, 23, 104]); // stop 1 exactly
    expect(viridisRgb(0.1)).toEqual([71, 34, 113]);
    expect(viridisRgb(2 / 15)).toEqual([71, 44, 122]); // stop 2 exactly
    expect(viridisRgb(0.25)).toEqual([60, 77, 138]);
    expect(viridisRgb(1 / 3)).toEqual([50, 101, 142]); // lands on stop 5
    expect(viridisRgb(0.5)).toEqual([33, 150, 139]);
    expect(viridisRgb(0.75)).toEqual([82, 212, 70]);
    expect(viridisRgb(1)).toEqual([253, 231, 37]);
  });

  it("clamps out-of-range inputs to the endpoints", () => {
    expect(viridisRgb(-0.5)).toEqual([68, 1, 84]);
    expect(viridisRgb(1.5)).toEqual([253, 231, 37]);
  });
});

describe("viridisHex", () => {
  it("formats the stops as #rrggbb", () => {
    expect(viridisHex(0)).toBe("#440154");
    expect(viridisHex(0.5)).toBe("#21968b");
    expect(viridisHex(1)).toBe("#fde725");
    expect(viridisHex(1 / 3)).toBe("#32658e");
  });
});

describe("viridisCss", () => {
  it("samples the 256-step table positions used for point fills", () => {
    expect(viridisCss(0)).toBe("68,1,84");
    expect(viridisCss(64 / 255)).toBe("60,78,138");
    expect(viridisCss(128 / 255)).toBe("33,150,138");
    expect(viridisCss(255 / 255)).toBe("253,231,37");
  });
});

describe("VIRIDIS_STOPS", () => {
  it("has 16 stops bracketed by the dark and bright endpoints", () => {
    expect(VIRIDIS_STOPS).toHaveLength(16);
    expect(VIRIDIS_STOPS[0]).toEqual([68, 1, 84]);
    expect(VIRIDIS_STOPS[15]).toEqual([253, 231, 37]);
  });
});

describe("wongColor", () => {
  it("cycles the seven-color Wong palette in Makie's order", () => {
    expect(WONG_COLORS).toHaveLength(7);
    expect(wongColor(0)).toBe("#0072b2");
    expect(wongColor(1)).toBe("#e69f00");
    expect(wongColor(7)).toBe("#0072b2");
  });
});
