import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { initSeed } from "../src/init";

let dir: string;
const TEMPLATES = join(__dirname, "..", "templates");

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "mcmcjs-init-test-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("initSeed", () => {
  it("seeds the example files into an empty directory", () => {
    const target = join(dir, "fresh");
    const files = initSeed(target, TEMPLATES, false);
    expect(files).toEqual([
      "README.md",
      "data.csv",
      "model.jl",
      "model.stan",
      "run_without_mcmcjs.jl",
    ]);
    expect(readdirSync(target).sort()).toEqual(files);
  });

  it("refuses a non-empty directory without --force", () => {
    writeFileSync(join(dir, "existing.txt"), "x");
    expect(() => initSeed(dir, TEMPLATES, false)).toThrow(/not empty; pass --force/);
  });

  it("seeds into a non-empty directory with force", () => {
    writeFileSync(join(dir, "existing.txt"), "x");
    const files = initSeed(dir, TEMPLATES, true);
    expect(files).toContain("model.jl");
    expect(readdirSync(dir)).toContain("existing.txt");
  });
});
