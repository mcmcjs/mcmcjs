import { mkdirSync, mkdtempSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { listCmdStanInstalls, resolveCmdStan } from "../src/environment";
import { parseIterationLine } from "../src/runner";

function makeInstall(root: string, version: string): string {
  const home = join(root, `cmdstan-${version}`);
  mkdirSync(join(home, "bin"), { recursive: true });
  writeFileSync(join(home, "makefile"), `CMDSTAN_VERSION := ${version}\n`);
  writeFileSync(join(home, "bin", "stanc"), "");
  return home;
}

const saved = { MCMCJS_CMDSTAN: process.env.MCMCJS_CMDSTAN, CMDSTAN: process.env.CMDSTAN };

afterEach(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("cmdstan resolution", () => {
  it("honors an explicit MCMCJS_CMDSTAN home", () => {
    const root = mkdtempSync(join(tmpdir(), "stan-env-"));
    const home = makeInstall(root, "2.39.0");
    process.env.MCMCJS_CMDSTAN = home;
    expect(listCmdStanInstalls()).toEqual([{ version: "2.39.0", home }]);
    expect(resolveCmdStan("installed").version).toBe("2.39.0");
    expect(resolveCmdStan("2.39.0").home).toBe(home);
    expect(() => resolveCmdStan("2.38.0")).toThrow(/CmdStan 2.38.0 not found/);
  });

  it("rejects an explicit home that is not a CmdStan directory", () => {
    process.env.MCMCJS_CMDSTAN = mkdtempSync(join(tmpdir(), "stan-empty-"));
    expect(() => listCmdStanInstalls()).toThrow(/not a CmdStan directory/);
    expect(() => resolveCmdStan()).toThrow(/not a CmdStan directory/);
  });

  it("prefers the final release over its release candidate", () => {
    const root = mkdtempSync(join(tmpdir(), "stan-rc-"));
    makeInstall(root, "2.39.0-rc2");
    makeInstall(root, "2.39.0");
    process.env.XDG_DATA_HOME = root;
    mkdirSync(join(root, "mcmcjs", "stan"), { recursive: true });
    // Point the managed root at our fixture by moving the installs there.
    delete process.env.MCMCJS_CMDSTAN;
    delete process.env.CMDSTAN;
    renameSync(
      join(root, "cmdstan-2.39.0-rc2"),
      join(root, "mcmcjs", "stan", "cmdstan-2.39.0-rc2"),
    );
    renameSync(join(root, "cmdstan-2.39.0"), join(root, "mcmcjs", "stan", "cmdstan-2.39.0"));
    const saveHome = process.env.HOME;
    process.env.HOME = mkdtempSync(join(tmpdir(), "stan-home-")); // hide ~/.cmdstan
    try {
      expect(resolveCmdStan("installed").version).toBe("2.39.0");
    } finally {
      process.env.HOME = saveHome;
      delete process.env.XDG_DATA_HOME;
    }
  });
});

describe("parseIterationLine", () => {
  it("parses warmup and sampling progress lines", () => {
    expect(parseIterationLine("Iteration:   1 / 200 [  0%]  (Warmup)")).toEqual({
      iteration: 1,
      total: 200,
      warmup: true,
    });
    expect(parseIterationLine("Iteration: 200 / 200 [100%]  (Sampling)")).toEqual({
      iteration: 200,
      total: 200,
      warmup: false,
    });
    // The single-process-per-chain engine never sees prefixed lines, but they parse anyway.
    expect(parseIterationLine("Chain [2] Iteration: 100 / 400 [ 25%]  (Warmup)")?.total).toBe(400);
    expect(parseIterationLine("Gradient evaluation took 1e-06 seconds")).toBeNull();
  });
});
