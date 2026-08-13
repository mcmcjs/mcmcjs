import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { JULIA_ASSETS } from "../src/assets.generated";
import { driverDir, driverPath, pinnedEnvDir, workerPath } from "../src/runner-common";

const SRC = join(__dirname, "..", "src");

describe("the embedded Julia assets", () => {
  // A compiled binary ships these strings, not the files, so drift would mean
  // running a driver that no longer matches the source under review.
  it("match the driver and pinned env on disk", () => {
    const sources: Record<string, string> = {
      "driver.jl": join(SRC, "driver", "driver.jl"),
      "worker.jl": join(SRC, "driver", "worker.jl"),
      "fitlib.jl": join(SRC, "driver", "fitlib.jl"),
      "julia-env/Project.toml": join(SRC, "julia-env", "Project.toml"),
      "julia-env/Manifest.toml": join(SRC, "julia-env", "Manifest.toml"),
    };
    expect(Object.keys(JULIA_ASSETS).sort()).toEqual(Object.keys(sources).sort());
    for (const [name, path] of Object.entries(sources)) {
      expect(JULIA_ASSETS[name], `${name} is stale; run \`pnpm gen:julia-assets\``).toBe(
        readFileSync(path, "utf8"),
      );
    }
  });
});

describe("driverDir", () => {
  it("materializes every asset where Julia can include it", () => {
    const dir = driverDir();
    expect(existsSync(driverPath())).toBe(true);
    expect(existsSync(workerPath())).toBe(true);
    // driver.jl and worker.jl include fitlib.jl through @__DIR__.
    expect(existsSync(join(dir, "fitlib.jl"))).toBe(true);
    expect(existsSync(join(pinnedEnvDir(), "Manifest.toml"))).toBe(true);
  });

  it("is stable across calls and content-keyed", () => {
    expect(driverDir()).toBe(driverDir());
    expect(driverDir()).toMatch(/[0-9a-f]{16}$/);
  });

  it("writes the same bytes the source has", () => {
    expect(readFileSync(driverPath(), "utf8")).toBe(
      readFileSync(join(SRC, "driver", "driver.jl"), "utf8"),
    );
  });
});
