import { describe, expect, it } from "vitest";
import { formatTool } from "./doctor";

describe("formatTool", () => {
  it("shows the version and path when the tool is found", () => {
    const out = formatTool({ name: "julia", found: true, version: "1.12.6", path: "/x/julia" });
    expect(out).toContain("julia");
    expect(out).toContain("1.12.6");
    expect(out).toContain("/x/julia");
  });

  it("shows not found when the tool is missing", () => {
    expect(formatTool({ name: "juliaup", found: false })).toContain("not found");
  });
});
