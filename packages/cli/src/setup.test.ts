import type { SetupResult } from "@mcmcjs/julia";
import { describe, expect, it } from "vitest";
import { formatSetupResult } from "./setup";

const result = (over: Partial<SetupResult>): SetupResult => ({
  juliaup: { found: false },
  julia: { found: false },
  ready: false,
  steps: [],
  ...over,
});

describe("formatSetupResult", () => {
  it("reports readiness when the toolchain is already installed", () => {
    const out = formatSetupResult(
      result({
        juliaup: { found: true, version: "1.17.10" },
        julia: { found: true, version: "1.11.2" },
        ready: true,
      }),
    );
    expect(out).toContain("already installed");
    expect(out).toContain("ready");
    expect(out).toContain("1.11.2");
  });

  it("shows the command that would run on a dry run", () => {
    const out = formatSetupResult(
      result({
        steps: [
          {
            tool: "juliaup",
            label: "install juliaup (this also installs Julia)",
            command: { command: "sh", args: ["-c", "curl ... | sh"] },
            status: "skipped",
          },
        ],
      }),
      true,
    );
    expect(out).toContain("would");
    expect(out).toContain("sh -c");
    expect(out).toContain("not ready");
  });

  it("surfaces a failed install with its detail", () => {
    const out = formatSetupResult(
      result({
        steps: [
          {
            tool: "juliaup",
            label: "install juliaup",
            command: { command: "sh", args: [] },
            status: "failed",
            detail: "network down",
          },
        ],
      }),
    );
    expect(out).toContain("fail");
    expect(out).toContain("network down");
    expect(out).toContain("not ready");
  });

  it("notes when automatic install is unsupported", () => {
    const out = formatSetupResult(
      result({
        steps: [
          { tool: "juliaup", label: "install juliaup", command: null, status: "unsupported" },
        ],
      }),
    );
    expect(out).toContain("cannot auto-install");
  });

  it("marks a successful install as ready", () => {
    const out = formatSetupResult(
      result({
        juliaup: { found: true, version: "1.17.10" },
        julia: { found: true, version: "1.11.2" },
        ready: true,
        steps: [
          {
            tool: "juliaup",
            label: "install juliaup",
            command: { command: "sh", args: [] },
            status: "ran",
          },
        ],
      }),
    );
    expect(out).toContain("ok");
    expect(out).toContain("ready");
  });
});
