import { describe, expect, it } from "vitest";
import { managedProjectDir, validatePins } from "../src/project";

describe("validatePins", () => {
  it("accepts managed packages and undefined", () => {
    expect(() => validatePins(undefined)).not.toThrow();
    expect(() => validatePins({ Turing: "0.45" })).not.toThrow();
  });

  it("rejects unknown packages with the valid set listed", () => {
    expect(() => validatePins({ Nope: "1.0" })).toThrow(/cannot pin unknown package "Nope"/);
    expect(() => validatePins({ Nope: "1.0" })).toThrow(/Turing/);
  });
});

describe("managedProjectDir keying", () => {
  it("appends the version as a path segment", () => {
    expect(managedProjectDir("1.12.6").endsWith("/env/1.12.6")).toBe(true);
  });

  it("sanitizes arch-suffixed versions", () => {
    expect(
      managedProjectDir("1.12.6+0.x64.linux.gnu").endsWith("/env/1.12.6_0.x64.linux.gnu"),
    ).toBe(true);
  });

  it("appends a stable hash suffix for pins, distinct per pin set", () => {
    const a = managedProjectDir("1.12.6", { Turing: "0.45" });
    const b = managedProjectDir("1.12.6", { Turing: "0.44" });
    const aAgain = managedProjectDir("1.12.6", { Turing: "0.45" });
    expect(a).toMatch(/\/env\/1\.12\.6-[0-9a-f]{8}$/);
    expect(a).toBe(aAgain);
    expect(a).not.toBe(b);
    expect(managedProjectDir("1.12.6")).not.toBe(a);
  });

  it("is stable across pin key order", () => {
    expect(managedProjectDir("1.12.6", { Turing: "0.45", MCMCChains: "7.0" })).toBe(
      managedProjectDir("1.12.6", { MCMCChains: "7.0", Turing: "0.45" }),
    );
  });

  it("returns the unversioned root with no version and no pins", () => {
    expect(managedProjectDir().endsWith("/julia/env")).toBe(true);
  });
});
