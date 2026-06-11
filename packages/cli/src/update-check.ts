import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { Command } from "commander";
import pc from "picocolors";

const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 5_000;
const REGISTRY_URL = "https://registry.npmjs.org/mcmcjs/latest";

export interface UpdateCache {
  checked_at: string;
  latest: string;
}

function cachePath(): string {
  const base = process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache");
  return join(base, "mcmcjs", "update-check.json");
}

export function readUpdateCache(path = cachePath()): UpdateCache | undefined {
  if (!existsSync(path)) return undefined;
  try {
    const doc = JSON.parse(readFileSync(path, "utf8")) as UpdateCache;
    return typeof doc.latest === "string" && typeof doc.checked_at === "string" ? doc : undefined;
  } catch {
    return undefined;
  }
}

export function writeUpdateCache(cache: UpdateCache, path = cachePath()): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(cache, null, 2)}\n`);
}

/** Plain x.y.z comparison; anything unparsable is never "newer". */
export function isNewer(candidate: string, current: string): boolean {
  const parse = (v: string) => /^(\d+)\.(\d+)\.(\d+)$/.exec(v.trim())?.slice(1).map(Number);
  const a = parse(candidate);
  const b = parse(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i += 1) {
    if ((a[i] as number) !== (b[i] as number)) return (a[i] as number) > (b[i] as number);
  }
  return false;
}

export function isStale(cache: UpdateCache | undefined, nowMs = Date.now()): boolean {
  if (!cache) return true;
  const at = Date.parse(cache.checked_at);
  return !Number.isFinite(at) || nowMs - at > CHECK_INTERVAL_MS;
}

export function updateNote(latest: string, current: string): string {
  return pc.dim(
    `\nnote: mcmcjs ${latest} is available (you have ${current}). Update with: npm install -g mcmcjs\n`,
  );
}

/**
 * Notifies about a newer release using only cached data (never blocks a
 * command on the network); refreshes the cache in a detached background
 * process at most once a day. Skipped without a TTY and in CI, so agent and
 * pipeline output stays byte-stable. MCMC_NO_UPDATE_CHECK=1 opts out entirely.
 */
export function maybeNotifyUpdate(currentVersion: string): void {
  if (process.env.MCMC_NO_UPDATE_CHECK === "1" || process.env.CI) return;
  if (!process.stderr.isTTY) return;

  const cache = readUpdateCache();
  if (cache && isNewer(cache.latest, currentVersion)) {
    process.on("exit", () => {
      process.stderr.write(updateNote(cache.latest, currentVersion));
    });
  }
  if (isStale(cache) && process.argv[1]) {
    const child = spawn(process.execPath, [process.argv[1], "__update-check"], {
      detached: true,
      stdio: "ignore",
    });
    child.on("error", () => {});
    child.unref();
  }
}

/** The hidden background refresh: fetch the latest version, write the cache, stay silent. */
export async function runUpdateCheck(): Promise<void> {
  try {
    const response = await fetch(REGISTRY_URL, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!response.ok) return;
    const doc = (await response.json()) as { version?: string };
    if (typeof doc.version !== "string") return;
    writeUpdateCache({ checked_at: new Date().toISOString(), latest: doc.version });
  } catch {}
}

export function registerUpdateCheck(program: Command): void {
  program.command("__update-check", { hidden: true }).action(runUpdateCheck);
}
