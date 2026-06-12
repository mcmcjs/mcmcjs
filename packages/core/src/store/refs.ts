import { createHash } from "node:crypto";
import { canonicalJson } from "../spec/normalize";
import type { Ledger, LedgerEntry, LedgerSampler } from "./ledger";

export interface RunKeyParts {
  backend: { id: string; version: string };
  model_sha256: string | undefined;
  entry: string;
  sampler: LedgerSampler;
  data_sha256: string;
  /** Managed-package version pins, when any; omitted from the key when absent. */
  packages?: Record<string, string>;
}

/** Stable same-experiment key; the seed is deliberately not part of it. */
export function computeRunKey(parts: RunKeyParts): string {
  return createHash("sha256").update(canonicalJson(parts)).digest("hex");
}

/** Sortable, unique run id: UTC timestamp plus a prefix of the run key. */
export function makeRunId(startedAt: Date, runKey: string): string {
  const stamp = startedAt.toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
  return `${stamp}-${runKey.slice(0, 6)}`;
}

const MIN_ID_PREFIX = 4;

/**
 * Resolves a run ref against the ledger, newest first.
 * Grammar: omitted or "latest" (newest), "@N" (N-th newest, 1-based), or a
 * run-id prefix of at least four characters.
 */
export function resolveRunRef(ledger: Ledger, ref?: string): LedgerEntry {
  const newestFirst = [...ledger.runs].reverse();
  if (newestFirst.length === 0) {
    throw new Error("no runs in the store yet; run `mcmc run <model>` first");
  }
  if (ref === undefined || ref === "latest") return newestFirst[0] as LedgerEntry;

  const ordinal = /^@(\d+)$/.exec(ref);
  if (ordinal) {
    const n = Number.parseInt(ordinal[1] as string, 10);
    const entry = newestFirst[n - 1];
    if (!entry)
      throw new Error(`run ${ref} does not exist (${newestFirst.length} runs in the store)`);
    return entry;
  }

  if (ref.length < MIN_ID_PREFIX) {
    throw new Error(
      `run ref "${ref}" is too short; use latest, @N, or at least ${MIN_ID_PREFIX} characters of a run id`,
    );
  }
  const matches = newestFirst.filter((entry) => entry.id.startsWith(ref));
  if (matches.length === 0) throw new Error(`no run matches "${ref}"`);
  if (matches.length > 1) {
    throw new Error(`run ref "${ref}" is ambiguous (${matches.map((m) => m.id).join(", ")})`);
  }
  return matches[0] as LedgerEntry;
}
