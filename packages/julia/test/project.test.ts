import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CommandRunner } from "@mcmcjs/engine";
import { describe, expect, it } from "vitest";
import {
  ensureProject,
  managedProjectReady,
  validatePins,
  validateVersionString,
} from "../src/project";

const freshDir = (): string => mkdtempSync(join(tmpdir(), "mcmcjs-proj-"));

describe("ensureProject", () => {
  it("provisions a fresh dir with the inference packages and marks it ready", async () => {
    const dir = freshDir();
    let code = "";
    const run: CommandRunner = async (_bin, args) => {
      code = args.at(-1) as string;
      writeFileSync(join(dir, "Project.toml"), "");
      return "";
    };
    await ensureProject("/bin/julia", run, dir);
    expect(code).toContain("Pkg.add");
    for (const pkg of ["Turing", "JuliaBUGS", "AdvancedHMC", "ForwardDiff"]) {
      expect(code).toContain(pkg);
    }
    expect(managedProjectReady(dir)).toBe(true);
  });

  it("is a no-op once provisioned with the current package set", async () => {
    const dir = freshDir();
    let calls = 0;
    const run: CommandRunner = async () => {
      calls += 1;
      writeFileSync(join(dir, "Project.toml"), "");
      return "";
    };
    await ensureProject("/bin/julia", run, dir);
    await ensureProject("/bin/julia", run, dir);
    expect(calls).toBe(1);
  });

  it("heals an existing env that lacks the sentinel", async () => {
    const dir = freshDir();
    writeFileSync(join(dir, "Project.toml"), "");
    expect(managedProjectReady(dir)).toBe(false);
    let calls = 0;
    const run: CommandRunner = async () => {
      calls += 1;
      return "";
    };
    await ensureProject("/bin/julia", run, dir);
    expect(calls).toBe(1);
    expect(managedProjectReady(dir)).toBe(true);
  });

  it("heals an env provisioned with an older package set", async () => {
    const dir = freshDir();
    writeFileSync(join(dir, "Project.toml"), "");
    writeFileSync(
      join(dir, ".mcmcjs-packages.json"),
      JSON.stringify(["JSON", "MCMCChains", "StableRNGs", "Turing"]),
    );
    expect(managedProjectReady(dir)).toBe(false);
    let calls = 0;
    const run: CommandRunner = async () => {
      calls += 1;
      return "";
    };
    await ensureProject("/bin/julia", run, dir);
    expect(calls).toBe(1);
    expect(managedProjectReady(dir)).toBe(true);
  });

  it("emits a version-pinned PackageSpec and keys readiness on the pins", async () => {
    const dir = freshDir();
    let code = "";
    const run: CommandRunner = async (_bin, args) => {
      code = args.at(-1) as string;
      writeFileSync(join(dir, "Project.toml"), "");
      return "";
    };
    await ensureProject("/bin/julia", run, dir, { Turing: "0.45" });
    expect(code).toContain('Pkg.PackageSpec(name="Turing", version="0.45")');
    expect(managedProjectReady(dir, { Turing: "0.45" })).toBe(true);
    // An env provisioned with a pin is not "ready" for a different pin set.
    expect(managedProjectReady(dir)).toBe(false);
    expect(managedProjectReady(dir, { Turing: "0.44" })).toBe(false);
  });
});

describe("validateVersionString / validatePins (injection guard)", () => {
  it("accepts ordinary version specifiers", () => {
    for (const v of ["0.45", "0.45.1", "^0.45", "~1.2", ">=0.4, <0.5", "1.0.0-rc1"]) {
      expect(() => validateVersionString("Turing", v)).not.toThrow();
    }
  });

  it("rejects version strings that could run Julia code", () => {
    for (const v of ["$(run(`touch x`))", '0.45"; run(`x`); #', "0.45`x`", "$x"]) {
      expect(() => validateVersionString("Turing", v)).toThrow(/invalid version/);
    }
  });

  it("validatePins rejects an unsafe version even for a managed package", () => {
    expect(() => validatePins({ Turing: "$(rm)" })).toThrow(/invalid version/);
    expect(() => validatePins({ Nope: "0.1" })).toThrow(/unknown package/);
  });
});
