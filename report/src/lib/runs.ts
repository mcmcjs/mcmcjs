import {
  type LedgerEntry,
  parseSamples,
  RUN_BUNDLE_KIND,
  RUN_BUNDLE_SCHEMA_VERSION,
  type RunBundle,
  type Samples,
} from "@mcmcjs/core";
import { parse as parseToml } from "smol-toml";
import { candidateDescents, descend, pathSegments } from "./locate";

export function bundleTitle(bundle: RunBundle): string {
  const file = bundle.entry.model_path.split("/").pop() ?? bundle.entry.model_path;
  return file.replace(/\.[^.]+$/, "");
}

export function samplesOf(bundle: RunBundle): Samples {
  return parseSamples(JSON.stringify(bundle.samples));
}

/** Keeps only the flagged chains, preserving draw and stat layout. */
export function subsetChains(samples: Samples, keep: boolean[]): Samples {
  const kept = keep.map((k, i) => (k ? i : -1)).filter((i) => i >= 0);
  if (kept.length === samples.nChains) return samples;
  const slice = (flat: Float64Array): Float64Array => {
    const out = new Float64Array(kept.length * samples.nDraws);
    kept.forEach((chain, at) => {
      out.set(
        flat.subarray(chain * samples.nDraws, (chain + 1) * samples.nDraws),
        at * samples.nDraws,
      );
    });
    return out;
  };
  const draws = new Map<string, Float64Array>();
  for (const [name, flat] of samples.draws) draws.set(name, slice(flat));
  const sampleStats = new Map<string, Float64Array>();
  for (const [name, flat] of samples.sampleStats) sampleStats.set(name, slice(flat));
  return { ...samples, nChains: kept.length, draws, sampleStats };
}

async function readText(dir: FileSystemDirectoryHandle, name: string): Promise<string> {
  const handle = await dir.getFileHandle(name);
  const file = await handle.getFile();
  return file.text();
}

export async function readLedgerEntries(store: FileSystemDirectoryHandle): Promise<LedgerEntry[]> {
  const ledger = JSON.parse(await readText(store, "index.json")) as { runs?: LedgerEntry[] };
  return [...(ledger.runs ?? [])].reverse();
}

/** Assembles a bundle from one run directory of a connected store. */
export async function readStoreRun(
  store: FileSystemDirectoryHandle,
  entry: LedgerEntry,
): Promise<RunBundle> {
  const runs = await store.getDirectoryHandle("runs");
  const dir = await runs.getDirectoryHandle(entry.id);
  const modelFile = entry.model_path.split("/").pop() ?? entry.model_path;
  const [specText, modelSource, samplesText] = await Promise.all([
    readText(dir, "spec.toml"),
    readText(dir, modelFile),
    readText(dir, "samples.json"),
  ]);
  return {
    kind: RUN_BUNDLE_KIND,
    schema_version: RUN_BUNDLE_SCHEMA_VERSION,
    entry,
    spec: parseToml(specText) as Record<string, unknown>,
    model_source: modelSource,
    samples: JSON.parse(samplesText) as Record<string, unknown>,
  };
}

export async function verifyStoreHandle(handle: FileSystemDirectoryHandle): Promise<boolean> {
  try {
    await handle.getFileHandle("index.json");
    return true;
  } catch {
    return false;
  }
}

/** Re-checks a stored handle's permission; prompting needs a user gesture. */
export async function ensurePermission(
  handle: FileSystemDirectoryHandle,
  prompt: boolean,
): Promise<boolean> {
  const state = await handle.queryPermission({ mode: "read" });
  if (state === "granted") return true;
  if (!prompt) return false;
  return (await handle.requestPermission({ mode: "read" })) === "granted";
}

/**
 * Finds a granted folder that reaches the store path. The picker cannot start
 * at a path, so grants are matched by folder name and walked down; a granted
 * parent (home, a projects folder) therefore opens every store beneath it.
 */
export async function locateStore(
  roots: FileSystemDirectoryHandle[],
  storePath: string,
  prompt: boolean,
): Promise<FileSystemDirectoryHandle | null> {
  const last = pathSegments(storePath).at(-1);
  for (const root of roots) {
    if (!(await ensurePermission(root, prompt))) continue;
    if (root.name === last && (await verifyStoreHandle(root))) return root;
    for (const segments of candidateDescents(root.name, storePath)) {
      const dir = await descend(root, segments);
      if (dir && (await verifyStoreHandle(dir))) return dir;
    }
  }
  return null;
}

export function timeAgo(iso: string, nowMs = Date.now()): string {
  const seconds = Math.max(0, Math.round((nowMs - Date.parse(iso)) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function downloadBundle(bundle: RunBundle): void {
  const blob = new Blob([JSON.stringify(bundle)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${bundleTitle(bundle)}.mcmcrun.json`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
    a.remove();
  }, 0);
}
