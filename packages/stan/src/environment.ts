import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { type CommandRunner, createRunner, type ToolInfo } from "@mcmcjs/engine";

export type { CommandRunner, ToolInfo } from "@mcmcjs/engine";
export { createRunner } from "@mcmcjs/engine";

const defaultRunner = createRunner();

import { DEFAULT_CMDSTAN_CHANNEL } from "@mcmcjs/core";

/** The spec channel meaning "use whatever CmdStan is installed locally". */
export const INSTALLED_CMDSTAN_CHANNEL = DEFAULT_CMDSTAN_CHANNEL;

/** The CmdStan version `mcmc setup --engine stan` provisions. */
export const PINNED_CMDSTAN_VERSION = "2.39.0";

/** A CmdStan installation found on this machine. */
export interface CmdStanInstall {
  version: string;
  /** The cmdstan home directory (contains makefile, bin/stanc, examples/). */
  home: string;
}

/** The managed root for CmdStan installs: `<data>/mcmcjs/stan`. */
export function managedStanRoot(): string {
  const home = process.env.HOME || homedir();
  const dataHome = process.env.XDG_DATA_HOME || join(home, ".local", "share");
  return join(dataHome, "mcmcjs", "stan");
}

/** A directory is a usable CmdStan home when the makefile and stanc are present. */
export function isCmdStanHome(dir: string): boolean {
  return existsSync(join(dir, "makefile")) && existsSync(join(dir, "bin", "stanc"));
}

function versionFromDirName(dir: string): string | undefined {
  return basename(dir).match(/^cmdstan-(\d+\.\d+\.\d+(?:-rc\d+)?)$/)?.[1];
}

function versionFromMakefile(home: string): string | undefined {
  try {
    const makefile = readFileSync(join(home, "makefile"), "utf8");
    return makefile.match(/CMDSTAN_VERSION\s*:?=\s*(\S+)/)?.[1];
  } catch {
    return undefined;
  }
}

function installAt(home: string): CmdStanInstall | undefined {
  if (!isCmdStanHome(home)) return undefined;
  const version = versionFromDirName(home) ?? versionFromMakefile(home);
  return version ? { version, home } : undefined;
}

function scanRoot(root: string): CmdStanInstall[] {
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return [];
  }
  const installs: CmdStanInstall[] = [];
  for (const name of entries) {
    if (!name.startsWith("cmdstan-")) continue;
    const install = installAt(join(root, name));
    if (install) installs.push(install);
  }
  return installs;
}

function compareVersions(a: string, b: string): number {
  const parse = (v: string) => {
    const [core, rc] = v.split("-rc");
    const nums = (core ?? "").split(".").map((p) => Number.parseInt(p, 10) || 0);
    // A release candidate sorts before its final release.
    return { nums, rc: rc === undefined ? Number.POSITIVE_INFINITY : Number.parseInt(rc, 10) || 0 };
  };
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < Math.max(pa.nums.length, pb.nums.length); i++) {
    const d = (pa.nums[i] ?? 0) - (pb.nums[i] ?? 0);
    if (d !== 0) return d;
  }
  if (pa.rc === pb.rc) return 0;
  return pa.rc < pb.rc ? -1 : 1;
}

/**
 * Every CmdStan install visible to mcmcjs, newest first: an explicit
 * MCMCJS_CMDSTAN/CMDSTAN home wins, then the managed root, then the
 * conventional `~/.cmdstan` used by other Stan interfaces.
 */
export function listCmdStanInstalls(): CmdStanInstall[] {
  const explicit = process.env.MCMCJS_CMDSTAN || process.env.CMDSTAN;
  if (explicit) {
    const install = installAt(explicit);
    if (!install) {
      throw new Error(
        `MCMCJS_CMDSTAN/CMDSTAN points at ${explicit}, which is not a CmdStan directory (expected a makefile and bin/stanc); unset it or point it at a CmdStan home.`,
      );
    }
    return [install];
  }
  const home = process.env.HOME || homedir();
  const installs = [...scanRoot(managedStanRoot()), ...scanRoot(join(home, ".cmdstan"))];
  return installs.sort((a, b) => compareVersions(b.version, a.version));
}

/**
 * Resolves the CmdStan install a fit runs on. `installed` (the default channel)
 * takes the newest local install; an explicit version must match exactly.
 */
export function resolveCmdStan(requested: string = INSTALLED_CMDSTAN_CHANNEL): CmdStanInstall {
  const installs = listCmdStanInstalls();
  if (requested === INSTALLED_CMDSTAN_CHANNEL) {
    const newest = installs[0];
    if (newest) return newest;
    throw new Error(
      "CmdStan not found. Run `mcmc setup --engine stan`, or point MCMCJS_CMDSTAN at a CmdStan directory.",
    );
  }
  const match = installs.find((i) => i.version === requested);
  if (match) return match;
  throw new Error(
    `CmdStan ${requested} not found. Run \`mcmc setup --engine stan --stan-version ${requested}\`, or point MCMCJS_CMDSTAN at a CmdStan directory.`,
  );
}

async function detect(
  command: string,
  args: string[],
  parseVersion: (stdout: string) => string | undefined,
  runner: CommandRunner,
): Promise<ToolInfo> {
  try {
    const version = parseVersion(await runner(command, args));
    if (version) return { found: true, version, path: command };
  } catch {
    // not available; fall through
  }
  return { found: false };
}

const versionNumber = (stdout: string): string | undefined =>
  stdout.match(/(\d+\.\d+(?:\.\d+)?)/)?.[1];

/** Detects GNU Make. */
export function detectMake(runner: CommandRunner = defaultRunner): Promise<ToolInfo> {
  return detect("make", ["--version"], versionNumber, runner);
}

/** Detects a C++ compiler (g++ first, then clang++). */
export async function detectCxx(runner: CommandRunner = defaultRunner): Promise<ToolInfo> {
  for (const command of ["g++", "clang++"]) {
    const info = await detect(command, ["--version"], versionNumber, runner);
    if (info.found) return info;
  }
  return { found: false };
}

/** Probes `bin/stanc --version` of an install. */
export async function detectStanc(
  install: CmdStanInstall | undefined,
  runner: CommandRunner = defaultRunner,
): Promise<ToolInfo> {
  if (!install) return { found: false };
  const stanc = join(install.home, "bin", "stanc");
  return detect(stanc, ["--version"], versionNumber, runner);
}
