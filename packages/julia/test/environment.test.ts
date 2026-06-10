import { describe, expect, it } from "vitest";
import { type CommandRunner, detectJulia, detectJuliaup } from "../src/environment";

describe("detectJulia", () => {
  it("parses the version from `julia --version`", async () => {
    const runner: CommandRunner = async () => "julia version 1.11.2\n";
    const info = await detectJulia(runner);
    expect(info.found).toBe(true);
    expect(info.version).toBe("1.11.2");
    expect(info.path).toMatch(/julia$/);
  });

  it("reports not found when every candidate errors", async () => {
    const runner: CommandRunner = async () => {
      throw new Error("ENOENT");
    };
    expect(await detectJulia(runner)).toEqual({ found: false });
  });

  it("falls back to the next candidate", async () => {
    let calls = 0;
    const runner: CommandRunner = async () => {
      calls += 1;
      if (calls === 1) throw new Error("not here");
      return "julia version 1.10.0";
    };
    expect((await detectJulia(runner)).version).toBe("1.10.0");
  });
});

describe("detectJuliaup", () => {
  it("parses the juliaup version", async () => {
    const runner: CommandRunner = async () => "Juliaup 1.17.10\n";
    expect((await detectJuliaup(runner)).version).toBe("1.17.10");
  });
});
