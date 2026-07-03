import { rmSync } from "node:fs";
import { join } from "node:path";
import type { RuntimeVersion } from "@mcmcjs/engine";
import { listCmdStanInstalls, managedStanRoot } from "./environment";
import { runSetup, type StanSetupOptions, type StanSetupResult } from "./setup";

/**
 * Lists the installed CmdStan versions, newest first. The newest is the
 * default: the `installed` channel resolves to it.
 */
export function listVersions(): RuntimeVersion[] {
  return listCmdStanInstalls().map((install, index) => ({
    id: install.version,
    version: install.version,
    path: install.home,
    isDefault: index === 0,
  }));
}

/** Installs a CmdStan version into the managed root. */
export function addVersion(
  version: string,
  options: Omit<StanSetupOptions, "version"> = {},
): Promise<StanSetupResult> {
  return runSetup({ ...options, version });
}

/**
 * Removes a managed CmdStan install. Only versions under the managed root are
 * removable; `~/.cmdstan` installs and explicit env-var homes are never touched.
 */
export function removeVersion(version: string): void {
  const install = listCmdStanInstalls().find((i) => i.version === version);
  if (!install) {
    throw new Error(`CmdStan ${version} is not installed`);
  }
  const managedHome = join(managedStanRoot(), `cmdstan-${version}`);
  if (install.home !== managedHome) {
    throw new Error(
      `CmdStan ${version} at ${install.home} is not managed by mcmcjs; remove it yourself if intended`,
    );
  }
  rmSync(managedHome, { recursive: true, force: true });
}
