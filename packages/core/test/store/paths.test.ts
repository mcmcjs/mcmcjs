import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ensureStore, findStore, runDir, storeDirFor } from "../../src/store/paths";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "mcmcjs-store-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("findStore", () => {
  it("finds an existing store in a parent directory", () => {
    mkdirSync(join(root, ".mcmc"));
    mkdirSync(join(root, "a", "b"), { recursive: true });
    expect(findStore(join(root, "a", "b"))).toBe(join(root, ".mcmc"));
  });

  it("returns undefined when no store exists up the tree", () => {
    mkdirSync(join(root, "a"), { recursive: true });
    expect(findStore(join(root, "a"))).toBeUndefined();
  });

  it("ignores a plain file named .mcmc", () => {
    writeFileSync(join(root, ".mcmc"), "");
    expect(findStore(root)).toBeUndefined();
  });
});

describe("storeDirFor", () => {
  it("defaults to a store beside the input file", () => {
    const model = join(root, "model.jl");
    expect(storeDirFor(model)).toBe(join(root, ".mcmc"));
  });

  it("prefers an existing store above the input", () => {
    mkdirSync(join(root, ".mcmc"));
    const model = join(root, "sub", "model.jl");
    mkdirSync(join(root, "sub"));
    expect(storeDirFor(model)).toBe(join(root, ".mcmc"));
  });

  it("honors an explicit override", () => {
    const model = join(root, "model.jl");
    expect(storeDirFor(model, join(root, "elsewhere"))).toBe(join(root, "elsewhere"));
  });
});

describe("ensureStore", () => {
  it("creates runs/ and a self-ignoring .gitignore", () => {
    const store = join(root, ".mcmc");
    ensureStore(store);
    expect(existsSync(join(store, "runs"))).toBe(true);
    expect(readFileSync(join(store, ".gitignore"), "utf8")).toBe("*\n");
  });

  it("leaves an existing .gitignore alone", () => {
    const store = join(root, ".mcmc");
    ensureStore(store);
    writeFileSync(join(store, ".gitignore"), "custom\n");
    ensureStore(store);
    expect(readFileSync(join(store, ".gitignore"), "utf8")).toBe("custom\n");
  });
});

describe("runDir", () => {
  it("nests run dirs under runs/", () => {
    expect(runDir("/s/.mcmc", "20260611-104210-a1b2c3")).toBe(
      join("/s/.mcmc", "runs", "20260611-104210-a1b2c3"),
    );
  });
});
