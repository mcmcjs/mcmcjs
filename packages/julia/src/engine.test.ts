import type { CommandRunner, EngineContext } from "@mcmcjs/engine";
import { describe, expect, it } from "vitest";
import { juliaEngine } from "./engine";

const context = (run: CommandRunner): EngineContext => ({ run, platform: "linux" });

describe("juliaEngine", () => {
  it("declares its id and capabilities", () => {
    expect(juliaEngine.id).toBe("julia");
    expect(juliaEngine.capabilities.versions).toBe(true);
    expect(juliaEngine.capabilities.fit).toBe(true);
    expect(juliaEngine.capabilities.predict).toBe(false);
  });

  it("reports the juliaup and julia tools and readiness", async () => {
    const run: CommandRunner = async (command) =>
      command.endsWith("juliaup") ? "Juliaup 1.20.4" : "julia version 1.12.6";
    const report = await juliaEngine.doctor(context(run));
    expect(report.engineId).toBe("julia");
    expect(report.ready).toBe(true);
    expect(report.tools.map((t) => t.name)).toEqual(["juliaup", "julia"]);
    expect(report.hint).toBeUndefined();
  });

  it("is not ready and gives a hint when Julia is missing", async () => {
    const run: CommandRunner = async () => {
      throw new Error("ENOENT");
    };
    const report = await juliaEngine.doctor(context(run));
    expect(report.ready).toBe(false);
    expect(report.hint).toMatch(/juliaup/);
  });
});
