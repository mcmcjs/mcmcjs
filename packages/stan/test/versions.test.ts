import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { listVersions, removeVersion } from "../src/versions";

const saved = {
  MCMCJS_CMDSTAN: process.env.MCMCJS_CMDSTAN,
  CMDSTAN: process.env.CMDSTAN,
  XDG_DATA_HOME: process.env.XDG_DATA_HOME,
  HOME: process.env.HOME,
};

afterEach(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function isolate(): string {
  delete process.env.MCMCJS_CMDSTAN;
  delete process.env.CMDSTAN;
  const root = mkdtempSync(join(tmpdir(), "stan-versions-"));
  process.env.XDG_DATA_HOME = root;
  process.env.HOME = mkdtempSync(join(tmpdir(), "stan-home-"));
  return join(root, "mcmcjs", "stan");
}

function makeInstall(root: string, version: string): string {
  const home = join(root, `cmdstan-${version}`);
  mkdirSync(join(home, "bin"), { recursive: true });
  writeFileSync(join(home, "makefile"), `CMDSTAN_VERSION := ${version}\n`);
  writeFileSync(join(home, "bin", "stanc"), "");
  return home;
}

describe("listVersions", () => {
  it("lists installed versions newest first with the default marked", () => {
    const managed = isolate();
    makeInstall(managed, "2.38.0");
    makeInstall(managed, "2.39.0");
    const versions = listVersions();
    expect(versions.map((v) => v.id)).toEqual(["2.39.0", "2.38.0"]);
    expect(versions[0]?.isDefault).toBe(true);
    expect(versions[1]?.isDefault).toBe(false);
  });
});

describe("removeVersion", () => {
  it("removes a managed install", () => {
    const managed = isolate();
    const home = makeInstall(managed, "2.38.0");
    removeVersion("2.38.0");
    expect(existsSync(home)).toBe(false);
  });

  it("refuses versions it does not manage", () => {
    isolate();
    const home = process.env.HOME as string;
    makeInstall(join(home, ".cmdstan"), "2.37.0");
    expect(() => removeVersion("2.37.0")).toThrow(/not managed by mcmcjs/);
    expect(() => removeVersion("9.9.9")).toThrow(/not installed/);
  });
});
