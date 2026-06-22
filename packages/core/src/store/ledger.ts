import { randomBytes } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

export const LEDGER_SCHEMA_VERSION = "0";

export interface LedgerSampler {
  algorithm: string;
  draws: number;
  warmup: number;
  chains: number;
  adapt_delta: number;
}

/** Convergence summary cached at fit time so listing never recomputes. */
export interface LedgerDiagnostics {
  converged: boolean;
  rhat_max: number | null;
  ess_bulk_min: number | null;
  ess_tail_min: number | null;
  divergences: number | null;
}

export interface LedgerEntry {
  id: string;
  /** Same-experiment key: backend + model + entry + sampler + data, seed excluded. */
  run_key: string;
  spec_hash: string;
  status: "ok" | "failed" | "cancelled";
  /** The model path relative to the store root's parent, with "/" separators. */
  model_path: string;
  model_sha256?: string;
  data_sha256: string;
  seed: number;
  backend: { id: string; version: string };
  sampler: LedgerSampler;
  /** The concrete Julia version that ran, when known. */
  julia?: string;
  started_at: string;
  elapsed_ms: number;
  diagnostics?: LedgerDiagnostics;
  error?: string;
}

export interface Ledger {
  schema_version: string;
  runs: LedgerEntry[];
}

function ledgerPath(storeDir: string): string {
  return join(storeDir, "index.json");
}

const LOCK_RETRIES = 50;
const LOCK_RETRY_MS = 100;
const LOCK_STALE_MS = 10_000;

function sleep(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** Advisory mkdir lock serializing ledger writers; stale locks are taken over. */
function withLedgerLock<T>(storeDir: string, fn: () => T): T {
  const lockDir = join(storeDir, "index.lock");
  for (let attempt = 0; ; attempt += 1) {
    try {
      mkdirSync(lockDir);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      try {
        if (Date.now() - statSync(lockDir).mtimeMs > LOCK_STALE_MS) {
          rmdirSync(lockDir);
          continue;
        }
      } catch {}
      if (attempt >= LOCK_RETRIES) {
        throw new Error(`run ledger is locked (${lockDir}); remove it if no mcmc is running`);
      }
      sleep(LOCK_RETRY_MS);
    }
  }
  try {
    return fn();
  } finally {
    try {
      rmdirSync(lockDir);
    } catch {}
  }
}

export function readLedger(storeDir: string): Ledger {
  const path = ledgerPath(storeDir);
  if (!existsSync(path)) return { schema_version: LEDGER_SCHEMA_VERSION, runs: [] };
  let doc: unknown;
  try {
    doc = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`corrupt run ledger ${path}: ${(error as Error).message}`);
  }
  const ledger = doc as Ledger;
  if (!ledger || typeof ledger !== "object" || !Array.isArray(ledger.runs)) {
    throw new Error(`corrupt run ledger ${path}: expected { schema_version, runs[] }`);
  }
  return ledger;
}

function writeLedger(storeDir: string, ledger: Ledger): void {
  const path = ledgerPath(storeDir);
  const tmp = `${path}.${process.pid}-${randomBytes(4).toString("hex")}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(ledger, null, 2)}\n`);
  renameSync(tmp, path);
}

/** Appends one run to the ledger; the read-modify-write runs under the lock. */
export function appendLedgerEntry(storeDir: string, entry: LedgerEntry): void {
  withLedgerLock(storeDir, () => {
    const ledger = readLedger(storeDir);
    ledger.runs.push(entry);
    writeLedger(storeDir, ledger);
  });
}

/** Replaces an entry by id (used to attach diagnostics after a fit). */
export function updateLedgerEntry(storeDir: string, entry: LedgerEntry): void {
  withLedgerLock(storeDir, () => {
    const ledger = readLedger(storeDir);
    const at = ledger.runs.findIndex((run) => run.id === entry.id);
    if (at === -1) throw new Error(`run ${entry.id} not found in ledger`);
    ledger.runs[at] = entry;
    writeLedger(storeDir, ledger);
  });
}

/** Removes entries by id, returning the removed entries. */
export function removeLedgerEntries(storeDir: string, ids: ReadonlySet<string>): LedgerEntry[] {
  return withLedgerLock(storeDir, () => {
    const ledger = readLedger(storeDir);
    const removed = ledger.runs.filter((run) => ids.has(run.id));
    if (removed.length > 0) {
      ledger.runs = ledger.runs.filter((run) => !ids.has(run.id));
      writeLedger(storeDir, ledger);
    }
    return removed;
  });
}

/** The newest completed run with the given key, for reuse checks. */
export function latestOkEntry(ledger: Ledger, runKey?: string): LedgerEntry | undefined {
  for (let i = ledger.runs.length - 1; i >= 0; i -= 1) {
    const entry = ledger.runs[i] as LedgerEntry;
    if (entry.status !== "ok") continue;
    if (runKey === undefined || entry.run_key === runKey) return entry;
  }
  return undefined;
}
