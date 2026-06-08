import { describe, expect, it } from "vitest";
import { formatVersions } from "./julia";

describe("formatVersions", () => {
  it("marks the default and lists each installed version", () => {
    const out = formatVersions([
      { id: "release", version: "1.12.6", path: "/x/release", isDefault: true },
      { id: "1.10", version: "1.10.5", path: "/x/1.10", isDefault: false },
    ]);
    expect(out).toContain("release");
    expect(out).toContain("1.10.5");
    expect(out).toContain("*");
  });

  it("guides the user when nothing is installed", () => {
    expect(formatVersions([])).toContain("mcmc julia version add");
  });
});
