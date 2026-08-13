import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { initSeed } from "../src/init";
import { TEMPLATE_FILES } from "../src/templates.generated";

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
    const files = initSeed(target, false);
    expect(files).toEqual([
      "README.md",
      "data.csv",
      "model.jl",
      "model.stan",
      "run_without_mcmcjs.jl",
    ]);
    expect(readdirSync(target).sort()).toEqual(files);
  });

  it("writes the file contents, not just the names", () => {
    const target = join(dir, "fresh");
    initSeed(target, false);
    expect(readFileSync(join(target, "model.jl"), "utf8")).toContain("using Turing");
  });

  it("refuses a non-empty directory without --force", () => {
    writeFileSync(join(dir, "existing.txt"), "x");
    expect(() => initSeed(dir, false)).toThrow(/not empty; pass --force/);
  });

  it("seeds into a non-empty directory with force", () => {
    writeFileSync(join(dir, "existing.txt"), "x");
    const files = initSeed(dir, true);
    expect(files).toContain("model.jl");
    expect(readdirSync(dir)).toContain("existing.txt");
  });
});

describe("the embedded templates", () => {
  // A compiled binary ships these strings, not the directory, so drift would
  // silently change what `mcmc init` writes.
  it("match packages/cli/templates on disk", () => {
    const names = readdirSync(TEMPLATES).sort();
    expect(Object.keys(TEMPLATE_FILES).sort()).toEqual(names);
    for (const name of names) {
      expect(TEMPLATE_FILES[name], `${name} is stale; run \`pnpm gen:templates\``).toBe(
        readFileSync(join(TEMPLATES, name), "utf8"),
      );
    }
  });
});
