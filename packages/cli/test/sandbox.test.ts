import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  relocate,
  resolveKeep,
  safeSegment,
  seedSandbox,
  strictEnv,
  uniqueTarget,
} from "../src/sandbox";

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

describe("resolveKeep", () => {
  const cwd = "/home/u/project";

  it("prompts when no disposition flag is given", () => {
    expect(resolveKeep({}, cwd)).toEqual({ mode: "prompt" });
  });

  it("deletes with --delete", () => {
    expect(resolveKeep({ delete: true }, cwd)).toEqual({ mode: "delete" });
  });

  it("keeps in place with --keep alone (no target)", () => {
    expect(resolveKeep({ keep: true }, cwd)).toEqual({ mode: "keep", target: undefined });
  });

  it("resolves --keep-dir relative to the launch cwd", () => {
    expect(resolveKeep({ keepDir: "exp/run1" }, cwd)).toEqual({
      mode: "keep",
      target: "/home/u/project/exp/run1",
    });
  });

  it("treats --name as a child of --keep-dir, or of the launch cwd alone", () => {
    expect(resolveKeep({ keepDir: "exp", name: "run1" }, cwd).mode).toBe("keep");
    expect(resolveKeep({ keepDir: "exp", name: "run1" }, cwd)).toMatchObject({
      target: "/home/u/project/exp/run1",
    });
    expect(resolveKeep({ name: "run1" }, cwd)).toMatchObject({ target: "/home/u/project/run1" });
  });

  it("rejects conflicting --delete with a keep flag", () => {
    expect(() => resolveKeep({ delete: true, keep: true }, cwd)).toThrow(/either --delete/);
    expect(() => resolveKeep({ delete: true, keepDir: "x" }, cwd)).toThrow(/either --delete/);
  });

  it("rejects an unsafe --name", () => {
    expect(() => resolveKeep({ name: "../escape" }, cwd)).toThrow(/single path segment/);
    expect(() => safeSegment("a/b")).toThrow(/single path segment/);
    expect(safeSegment(" ok-1.2 ")).toBe("ok-1.2");
  });
});

describe("uniqueTarget", () => {
  it("returns the path unchanged when free, else appends -2, -3", () => {
    expect(uniqueTarget(join(dir, "free"))).toBe(join(dir, "free"));
    mkdirSync(join(dir, "taken"));
    expect(uniqueTarget(join(dir, "taken"))).toBe(join(dir, "taken-2"));
    mkdirSync(join(dir, "taken-2"));
    expect(uniqueTarget(join(dir, "taken"))).toBe(join(dir, "taken-3"));
  });
});

describe("relocate", () => {
  it("copies the tree to the target and removes the source", () => {
    const src = join(dir, "src");
    mkdirSync(src);
    seedSandbox(src, TEMPLATES);
    const target = join(dir, "nested", "kept");
    const final = relocate(src, target);
    expect(final).toBe(target);
    expect(existsSync(src)).toBe(false);
    expect(existsSync(join(target, "model.jl"))).toBe(true);
  });
});

describe("strictEnv", () => {
  it("redirects every Julia/XDG state path inside the sandbox and creates the dirs", () => {
    const env = strictEnv(dir);
    for (const key of [
      "XDG_DATA_HOME",
      "XDG_CACHE_HOME",
      "XDG_RUNTIME_DIR",
      "JULIA_DEPOT_PATH",
      "JULIAUP_DEPOT_PATH",
    ]) {
      const path = env[key] as string;
      expect(path.startsWith(join(dir, "env"))).toBe(true);
      expect(existsSync(path)).toBe(true);
    }
    // The runtime dir holds sockets, so it must be private.
    expect(statSync(env.XDG_RUNTIME_DIR as string).mode & 0o777).toBe(0o700);
  });
});
