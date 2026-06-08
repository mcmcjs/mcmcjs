import { describe, expect, it } from "vitest";
import { createFitRunner } from "./runner";

describe("createFitRunner", () => {
  it("captures stdout and a zero exit code on success", async () => {
    const run = createFitRunner();
    const result = await run(process.execPath, ["-e", "process.stdout.write('hello')"]);
    expect(result.code).toBe(0);
    expect(result.stdout).toBe("hello");
  });

  it("captures stderr and the exit code without throwing on failure", async () => {
    const run = createFitRunner();
    const result = await run(process.execPath, [
      "-e",
      "process.stderr.write('boom'); process.exit(3)",
    ]);
    expect(result.code).toBe(3);
    expect(result.stderr).toContain("boom");
  });
});
