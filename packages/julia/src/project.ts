import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { canonicalJson, DEFAULT_JULIA_CHANNEL } from "@mcmcjs/core";
import { type CommandRunner, createRunner } from "@mcmcjs/engine";
import { pinnedEnvDir, sha256 } from "./runner-common";

const PACKAGES = [
  "Turing",
  "FlexiChains",
  "DimensionalData",
  "MCMCChains",
  "JuliaBUGS",
  "AdvancedHMC",
  "ForwardDiff",
  "JSON",
  "StableRNGs",
  "StatsFuns",
];

/** Version pins for managed packages, by name (e.g. { Turing: "0.45" }). */
export type PackagePins = Record<string, string>;

// Version strings are interpolated into Julia source for Pkg.add; this allows
// only the characters of a Julia version specifier (digits, letters, and the
// range operators) and notably excludes `$` and backticks, which would
// otherwise let a shared spec run arbitrary Julia via string interpolation.
const VERSION_RE = /^[0-9A-Za-z.+~^=<>,\s-]+$/;

/** Rejects a version string that could break out of the generated Julia literal. */
export function validateVersionString(name: string, version: string): void {
  if (!VERSION_RE.test(version)) {
    throw new Error(
      `invalid version "${version}" for package ${name}; a version may contain only digits, letters, and . + ~ ^ = < > , - and spaces`,
    );
  }
}

/** Rejects pins for unmanaged packages or with unsafe version strings. */
export function validatePins(pins: PackagePins | undefined): void {
  for (const [name, version] of Object.entries(pins ?? {})) {
    if (!PACKAGES.includes(name)) {
      throw new Error(
        `cannot pin unknown package "${name}"; managed packages are: ${PACKAGES.join(", ")}`,
      );
    }
    validateVersionString(name, version);
  }
}

function hasPins(pins?: PackagePins): pins is PackagePins {
  return pins !== undefined && Object.keys(pins).length > 0;
}

/**
 * The per-user directory holding a managed Julia project (Project + Manifest).
 * Keyed by the concrete Julia version AND any package pins, so each version
 * resolves its own compatible Manifest and each distinct set of pins gets its
 * own environment: a Manifest resolved by one Julia version (or package set)
 * can pin versions that fail to precompile under another. A missing version
 * and no pins falls back to the unversioned root.
 */
export function managedProjectDir(version?: string, pins?: PackagePins): string {
  const base = process.env.XDG_DATA_HOME || join(homedir(), ".local", "share");
  const root = join(base, "mcmcjs", "julia", "env");
  if (!version && !hasPins(pins)) return root;
  let leaf = (version ?? "default").replace(/[^A-Za-z0-9._-]/g, "_");
  if (hasPins(pins)) leaf += `-${sha256(canonicalJson(pins)).slice(0, 8)}`;
  return join(root, leaf);
}

// Records what a managed dir was provisioned with (package set + pins), so an
// env from an older set is healed (Pkg.add is additive) rather than left stale.
function sentinelPath(dir: string): string {
  return join(dir, ".mcmcjs-packages.json");
}

// Bumped when the provisioning changes shape so existing envs re-provision; e.g.
// generation 1 introduced instantiating the committed Manifest for the default,
// which a pre-existing fresh-resolved env must pick up.
const PROVISION_GENERATION = 1;

function expectedSentinel(pins?: PackagePins): string {
  return canonicalJson({
    gen: PROVISION_GENERATION,
    packages: [...PACKAGES].sort(),
    pins: pins ?? {},
  });
}

function provisioned(dir: string, pins?: PackagePins): boolean {
  try {
    return readFileSync(sentinelPath(dir), "utf8").trim() === expectedSentinel(pins);
  } catch {
    return false;
  }
}

/** Whether the managed project is present and provisioned with the current package set and pins. */
export function managedProjectReady(
  dir: string = managedProjectDir(),
  pins?: PackagePins,
): boolean {
  return existsSync(join(dir, "Project.toml")) && provisioned(dir, pins);
}

/** The `Pkg.add` argument: a PackageSpec per managed package, version-pinned where requested. */
function packageSpecsCode(pins?: PackagePins): string {
  const specs = PACKAGES.map((name) => {
    const version = pins?.[name];
    return version
      ? `Pkg.PackageSpec(name=${JSON.stringify(name)}, version=${JSON.stringify(version)})`
      : `Pkg.PackageSpec(name=${JSON.stringify(name)})`;
  });
  return `[${specs.join(", ")}]`;
}

/**
 * Whether a provision should instantiate the shipped, resolved env (exact
 * committed package set) rather than resolving fresh: only the unpinned default
 * on the pinned Julia version, and only when the shipped env is present. Other
 * versions (a `--versions` matrix) and any package pins must resolve fresh,
 * since the committed Manifest was resolved for one specific Julia version.
 */
function usesPinnedEnv(version: string | undefined, pins?: PackagePins): boolean {
  return !hasPins(pins) && version === DEFAULT_JULIA_CHANNEL && existsSync(pinnedEnvDir());
}

/**
 * Ensures the managed Julia project exists with the inference packages installed
 * (version-pinned where `pins` requests). Idempotent: returns immediately when
 * already provisioned with the current set and pins. For the default env on the
 * pinned Julia version it instantiates the shipped, resolved Manifest (the exact
 * committed package set); otherwise it resolves and adds the packages fresh. The
 * first provision precompiles the project, which can take several minutes.
 */
export async function ensureProject(
  juliaBin: string,
  run: CommandRunner = createRunner(30 * 60_000),
  dir: string = managedProjectDir(),
  pins?: PackagePins,
  opts?: { version?: string },
): Promise<string> {
  validatePins(pins);
  if (managedProjectReady(dir, pins)) return dir;
  mkdirSync(dir, { recursive: true });
  if (usesPinnedEnv(opts?.version, pins)) {
    copyFileSync(join(pinnedEnvDir(), "Project.toml"), join(dir, "Project.toml"));
    copyFileSync(join(pinnedEnvDir(), "Manifest.toml"), join(dir, "Manifest.toml"));
    await run(juliaBin, [
      "--startup-file=no",
      `--project=${dir}`,
      "-e",
      "using Pkg; Pkg.instantiate(); Pkg.precompile()",
    ]);
  } else {
    const code = `using Pkg; Pkg.add(${packageSpecsCode(pins)}); Pkg.precompile()`;
    await run(juliaBin, ["--startup-file=no", `--project=${dir}`, "-e", code]);
  }
  writeFileSync(sentinelPath(dir), expectedSentinel(pins));
  return dir;
}
