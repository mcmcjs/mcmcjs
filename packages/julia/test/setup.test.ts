import { describe, expect, it } from "vitest";
import type { DoctorReport } from "../src/doctor";
import type { CommandRunner, ToolInfo } from "../src/environment";
import { juliaupInstallCommand, planSetup, runSetup } from "../src/setup";

const missing: CommandRunner = async () => {
  throw new Error("ENOENT");
};

const tool = (found: boolean, path?: string): ToolInfo => (found ? { found, path } : { found });
const report = (juliaup: ToolInfo, julia: ToolInfo): DoctorReport => ({
  juliaup,
  julia,
  ready: julia.found,
});

describe("juliaupInstallCommand", () => {
  it("uses the official install script on Unix-like platforms", () => {
    const cmd = juliaupInstallCommand("linux");
    expect(cmd?.command).toBe("sh");
    expect(cmd?.args.at(-1)).toContain("install.julialang.org");
    expect(juliaupInstallCommand("darwin")?.command).toBe("sh");
  });

  it("has no automatic install on Windows yet", () => {
    expect(juliaupInstallCommand("win32")).toBeNull();
  });
});

describe("planSetup", () => {
  it("does nothing when Julia is already present", () => {
    expect(planSetup(report(tool(true), tool(true)), "linux")).toEqual([]);
  });

  it("adds Julia through an existing juliaup, using its detected path", () => {
    const steps = planSetup(
      report(tool(true, "/home/u/.juliaup/bin/juliaup"), tool(false)),
      "linux",
    );
    expect(steps).toHaveLength(1);
    expect(steps[0]?.tool).toBe("julia");
    expect(steps[0]?.command).toEqual({
      command: "/home/u/.juliaup/bin/juliaup",
      args: ["add", "release"],
    });
  });

  it("installs juliaup when nothing is present", () => {
    const steps = planSetup(report(tool(false), tool(false)), "linux");
    expect(steps).toHaveLength(1);
    expect(steps[0]?.tool).toBe("juliaup");
    expect(steps[0]?.command?.command).toBe("sh");
  });

  it("has no command for the juliaup step on an unsupported platform", () => {
    const steps = planSetup(report(tool(false), tool(false)), "win32");
    expect(steps[0]?.command).toBeNull();
  });
});

describe("runSetup", () => {
  it("does nothing when the toolchain is already ready", async () => {
    let installs = 0;
    const installer: CommandRunner = async () => {
      installs += 1;
      return "";
    };
    const result = await runSetup({
      runner: async () => "version 1.11.2",
      installer,
      platform: "linux",
    });
    expect(result.ready).toBe(true);
    expect(result.steps).toEqual([]);
    expect(installs).toBe(0);
  });

  it("installs the toolchain and reports ready on success", async () => {
    let installed = false;
    const runner: CommandRunner = async () => {
      if (!installed) throw new Error("ENOENT");
      return "version 1.11.2";
    };
    const installer: CommandRunner = async () => {
      installed = true;
      return "";
    };
    const result = await runSetup({ runner, installer, platform: "linux" });
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0]?.status).toBe("ran");
    expect(result.julia.found).toBe(true);
    expect(result.ready).toBe(true);
  });

  it("reports a failed step when the installer errors", async () => {
    const installer: CommandRunner = async () => {
      throw new Error("network down");
    };
    const result = await runSetup({ runner: missing, installer, platform: "linux" });
    expect(result.steps[0]?.status).toBe("failed");
    expect(result.steps[0]?.detail).toContain("network down");
    expect(result.ready).toBe(false);
  });

  it("does not run anything on a dry run", async () => {
    let installs = 0;
    const installer: CommandRunner = async () => {
      installs += 1;
      return "";
    };
    const result = await runSetup({ runner: missing, installer, platform: "linux", dryRun: true });
    expect(installs).toBe(0);
    expect(result.steps[0]?.status).toBe("skipped");
    expect(result.ready).toBe(false);
  });

  it("marks the step unsupported on a platform without auto-install", async () => {
    const result = await runSetup({ runner: missing, platform: "win32" });
    expect(result.steps[0]?.status).toBe("unsupported");
    expect(result.ready).toBe(false);
  });
});
