import { resolve } from "node:path";
import { findStore, STORE_DIR_NAME } from "@mcmcjs/core";

/** Locates the store for porcelain commands: --store, then MCMC_STORE, then the nearest store above cwd. */
export function locateStore(override?: string): string {
  const explicit = override ?? process.env.MCMC_STORE;
  if (explicit) return resolve(explicit);
  const found = findStore(process.cwd());
  if (!found) {
    throw new Error(
      `no ${STORE_DIR_NAME} store found at or above ${process.cwd()}; stores are created beside the model on first \`mcmc run\`, so cd next to the model or pass --store <dir>`,
    );
  }
  return found;
}

/** Compact relative time for run listings ("just now", "5m ago", "2h ago", "3d ago"). */
export function timeAgo(iso: string, nowMs = Date.now()): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  const s = Math.max(0, Math.floor((nowMs - t) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 30 * 86400) return `${Math.floor(s / 86400)}d ago`;
  return iso.slice(0, 10);
}
