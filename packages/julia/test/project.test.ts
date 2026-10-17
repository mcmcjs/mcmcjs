import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type CommandRunner, createRunner } from "@mcmcjs/engine";
import { describe, expect, it } from "vitest";
import {
  ensureProject,
  instantiateProject,
  managedProjectReady,
  validatePins,
  validateVersionString,
} from "../src/project";
import { pinnedEnvDir } from "../src/runner-common";

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

  it("stops being ready when the shipped Manifest is resolved anew", async () => {
    const dir = freshDir();
    const run: CommandRunner = async () => {
      writeFileSync(join(dir, "Project.toml"), "");
      return "";
    };
    await ensureProject("/bin/julia", run, dir);
    expect(managedProjectReady(dir)).toBe(true);

    const shipped = join(pinnedEnvDir(), "Manifest.toml");
    const before = readFileSync(shipped, "utf8");
    try {
      writeFileSync(shipped, `${before}\n# resolved anew\n`);
      expect(managedProjectReady(dir)).toBe(false);
    } finally {
      writeFileSync(shipped, before);
    }
    expect(managedProjectReady(dir)).toBe(true);
  });
});

describe("instantiateProject", () => {
  it.skipIf(process.env.MCMC_PROJECT_E2E !== "1")(
    "rejects a Manifest that was resolved for a different Project",
    async () => {
      const dir = freshDir();
      const julia = process.env.MCMC_JULIA_BIN ?? "julia";
      const run = createRunner(120_000);
      try {
        await run(julia, [
          "--startup-file=no",
          `--project=${dir}`,
          "-e",
          'using Pkg; Pkg.add("JSON")',
        ]);
        const originalManifest = readFileSync(join(dir, "Manifest.toml"), "utf8");
        await expect(instantiateProject(julia, dir, { run })).resolves.toBe(dir);
        appendFileSync(join(dir, "Project.toml"), '\n[compat]\nJSON = "0.21"\n');
        await expect(instantiateProject(julia, dir, { run })).rejects.toThrow(
          /Manifest.toml does not match Project.toml/,
        );
        expect(readFileSync(join(dir, "Manifest.toml"), "utf8")).toBe(originalManifest);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
    120_000,
  );

  it("instantiates a supplied Manifest before the cache hook and precompile", async () => {
    const dir = freshDir();
    const project = "[deps]\n";
    const manifest = 'julia_version = "1.12.6"\n';
    writeFileSync(join(dir, "Project.toml"), project);
    writeFileSync(join(dir, "Manifest.toml"), manifest);
    const calls: string[] = [];
    const run: CommandRunner = async (bin, args) => {
      expect(bin).toBe("/bin/julia");
      expect(args.slice(0, 2)).toEqual(["--startup-file=no", `--project=${dir}`]);
      calls.push(args.at(-1) as string);
      return "";
    };

    await expect(
      instantiateProject("/bin/julia", dir, {
        run,
        beforePrecompile: async (path) => {
          expect(path).toBe(dir);
          calls.push("cache");
        },
      }),
    ).resolves.toBe(dir);

    expect(calls).toHaveLength(3);
    expect(calls[0]).toContain("Pkg.instantiate(; allow_autoprecomp=false)");
    expect(calls[0]).toContain(
      'TOML.parsefile(joinpath(dirname(Base.active_project()), "Manifest.toml"))',
    );
    expect(calls[0]).toContain("(version.major, version.minor) == (VERSION.major, VERSION.minor)");
    expect(calls.slice(1)).toEqual(["cache", "using Pkg; Pkg.precompile()"]);
    expect(readFileSync(join(dir, "Project.toml"), "utf8")).toBe(project);
    expect(readFileSync(join(dir, "Manifest.toml"), "utf8")).toBe(manifest);
  });

  it("requires both environment files before starting Julia", async () => {
    const dir = freshDir();
    let calls = 0;
    const run: CommandRunner = async () => {
      calls += 1;
      return "";
    };
    await expect(instantiateProject("/bin/julia", dir, { run })).rejects.toThrow(/Project.toml/);
    writeFileSync(join(dir, "Project.toml"), "[deps]\n");
    await expect(instantiateProject("/bin/julia", dir, { run })).rejects.toThrow(/Manifest.toml/);
    expect(calls).toBe(0);
  });

  it("rejects files Julia would choose ahead of the supplied Project or Manifest", async () => {
    const dir = freshDir();
    writeFileSync(join(dir, "Project.toml"), "[deps]\n");
    writeFileSync(join(dir, "Manifest.toml"), 'julia_version = "1.12.6"\n');
    const run: CommandRunner = async () => {
      throw new Error("Julia should not start");
    };
    for (const name of ["JuliaProject.toml", "JuliaManifest.toml", "Manifest-v1.12.toml"]) {
      writeFileSync(join(dir, name), "");
      await expect(instantiateProject("/bin/julia", dir, { run })).rejects.toThrow(name);
      rmSync(join(dir, name));
    }
  });

  it("does not call the cache hook or precompile when instantiate fails", async () => {
    const dir = freshDir();
    writeFileSync(join(dir, "Project.toml"), "[deps]\n");
    writeFileSync(join(dir, "Manifest.toml"), 'julia_version = "1.12.6"\n');
    const calls: string[] = [];
    const run: CommandRunner = async () => {
      calls.push("instantiate");
      throw new Error("instantiate failed");
    };
    await expect(
      instantiateProject("/bin/julia", dir, {
        run,
        beforePrecompile: () => {
          calls.push("cache");
        },
      }),
    ).rejects.toThrow("instantiate failed");
    expect(calls).toEqual(["instantiate"]);
  });

  it("rejects and restores a Manifest rewritten during instantiate", async () => {
    const dir = freshDir();
    const manifestPath = join(dir, "Manifest.toml");
    const manifest = 'julia_version = "1.12.6"\n';
    writeFileSync(join(dir, "Project.toml"), "[deps]\n");
    writeFileSync(manifestPath, manifest);
    let calls = 0;
    const run: CommandRunner = async () => {
      calls += 1;
      writeFileSync(manifestPath, "changed\n");
      return "";
    };
    await expect(instantiateProject("/bin/julia", dir, { run })).rejects.toThrow(
      /changed the supplied Manifest.toml/,
    );
    expect(calls).toBe(1);
    expect(readFileSync(manifestPath, "utf8")).toBe(manifest);
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
