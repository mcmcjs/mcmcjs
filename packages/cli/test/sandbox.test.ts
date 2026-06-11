import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { seedSandbox } from "../src/sandbox";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "mcmcjs-sandbox-test-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const TEMPLATES = join(__dirname, "..", "templates");

describe("seedSandbox", () => {
  it("copies the example trio plus the README", () => {
    const names = seedSandbox(dir, TEMPLATES);
    expect(names).toEqual(["README.md", "data.csv", "model.jl", "run_without_mcmcjs.jl"]);
    expect(readFileSync(join(dir, "model.jl"), "utf8")).toContain("build_model(data)");
    expect(readFileSync(join(dir, "data.csv"), "utf8")).toMatch(/^x,y\n/);
    expect(readFileSync(join(dir, "run_without_mcmcjs.jl"), "utf8")).toContain("summarystats");
  });

  it("the seeded model detects as a Turing model", async () => {
    seedSandbox(dir, TEMPLATES);
    const { detectBackend } = await import("../src/run");
    expect(detectBackend(readFileSync(join(dir, "model.jl"), "utf8"))).toBe("turing");
  });
});
