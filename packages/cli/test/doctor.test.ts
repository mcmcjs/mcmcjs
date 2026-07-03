import type { HealthReport } from "@mcmcjs/engine";
import { describe, expect, it } from "vitest";
import { formatReport, formatTool } from "../src/doctor";

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

describe("formatReport", () => {
  it("titles the section and carries the hint when not ready", () => {
    const report: HealthReport = {
      engineId: "stan",
      ready: false,
      tools: [{ name: "cmdstan", found: false }],
      hint: "CmdStan not found. Run `mcmc setup --engine stan`.",
    };
    const out = formatReport(report, "Stan (CmdStan)");
    expect(out).toContain("Stan (CmdStan)");
    expect(out).toContain("cmdstan");
    expect(out).toContain("not ready");
    expect(out).toContain("mcmc setup --engine stan");
  });
});
