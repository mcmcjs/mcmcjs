import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { StanDoctorReport } from "../src/doctor";
import { planSetup, runSetup } from "../src/setup";

// planSetup probes the managed root on disk; point it at an empty temp dir so
// results do not depend on what this machine has installed.
const savedXdg = process.env.XDG_DATA_HOME;
beforeEach(() => {
  process.env.XDG_DATA_HOME = mkdtempSync(join(tmpdir(), "stan-setup-"));
});
afterEach(() => {
  if (savedXdg === undefined) delete process.env.XDG_DATA_HOME;
  else process.env.XDG_DATA_HOME = savedXdg;
});

const READY: StanDoctorReport = {
  cmdstan: { found: true, version: "2.39.0", path: "/x/cmdstan-2.39.0" },
  stanc: { found: true, version: "2.39.0" },
  make: { found: true, version: "4.4" },
  cxx: { found: true, version: "16.1" },
  install: { version: "2.39.0", home: "/x/cmdstan-2.39.0" },
  ready: true,
};

const BARE: StanDoctorReport = {
  cmdstan: { found: false },
  stanc: { found: false },
  make: { found: true, version: "4.4" },
  cxx: { found: true, version: "16.1" },
  ready: false,
};

describe("planSetup", () => {
  it("plans nothing when the pinned CmdStan is installed", () => {
    expect(planSetup(READY, "linux", "2.39.0")).toEqual([]);
  });

  it("plans download and build on a bare machine", () => {
    const steps = planSetup(BARE, "linux", "2.39.0");
    expect(steps.map((s) => s.tool)).toEqual(["cmdstan", "build"]);
    expect(steps[0]?.command?.args.join(" ")).toContain(
      "github.com/stan-dev/cmdstan/releases/download/v2.39.0/cmdstan-2.39.0.tar.gz",
    );
    expect(steps[1]?.command?.command).toBe("make");
  });

  it("reports a missing compiler as a manual step", () => {
    const report = { ...BARE, cxx: { found: false } };
    const steps = planSetup(report, "linux", "2.39.0");
    expect(steps[0]?.tool).toBe("toolchain");
    expect(steps[0]?.command).toBeNull();
    expect(steps[0]?.label).toContain("C++ compiler");
  });

  it("cannot auto-install on Windows", () => {
    const steps = planSetup(BARE, "win32", "2.39.0");
    expect(steps.every((s) => s.command === null)).toBe(true);
  });
});

describe("runSetup", () => {
  it("rejects an unsafe version string before running anything", async () => {
    await expect(runSetup({ version: "2.39.0; rm -rf /" })).rejects.toThrow(
      /invalid CmdStan version/,
    );
  });

  it("dry-run plans steps without executing the installer", async () => {
    let installs = 0;
    const result = await runSetup({
      dryRun: true,
      platform: "linux",
      version: "0.0.1",
      runner: async () => {
        throw new Error("nothing on this fake machine");
      },
      installer: async () => {
        installs += 1;
        return "";
      },
    });
    expect(installs).toBe(0);
    expect(result.steps.length).toBeGreaterThan(0);
    expect(result.steps.every((s) => s.status === "skipped" || s.status === "unsupported")).toBe(
      true,
    );
  });
});
