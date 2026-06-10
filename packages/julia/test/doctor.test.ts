import { describe, expect, it } from "vitest";
import { runDoctor } from "../src/doctor";
import type { CommandRunner } from "../src/environment";

describe("runDoctor", () => {
  it("is ready when Julia is available", async () => {
    const runner: CommandRunner = async (command) =>
      command.endsWith("juliaup") ? "Juliaup 1.17.10" : "julia version 1.11.2";
    const report = await runDoctor(runner);
    expect(report.juliaup.found).toBe(true);
    expect(report.julia.found).toBe(true);
    expect(report.ready).toBe(true);
  });

  it("is not ready when Julia is missing", async () => {
    const runner: CommandRunner = async () => {
      throw new Error("ENOENT");
    };
    expect((await runDoctor(runner)).ready).toBe(false);
  });
});
