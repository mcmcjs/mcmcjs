import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { seedSandbox, strictEnv } from "../src/sandbox";

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
