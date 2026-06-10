import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  appendLedgerEntry,
  type LedgerEntry,
  latestOkEntry,
  readLedger,
  removeLedgerEntries,
  updateLedgerEntry,
} from "../../src/store/ledger";

let store: string;

beforeEach(() => {
  store = mkdtempSync(join(tmpdir(), "mcmcjs-ledger-"));
});

afterEach(() => {
  rmSync(store, { recursive: true, force: true });
});

function entry(id: string, overrides: Partial<LedgerEntry> = {}): LedgerEntry {
  return {
    id,
    run_key: "k1",
    spec_hash: "s1",
    status: "ok",
    model_path: "model.jl",
    data_sha256: "d1",
    seed: 42,
    backend: { id: "turing", version: "release" },
    sampler: { algorithm: "NUTS", draws: 1000, warmup: 1000, chains: 4, adapt_delta: 0.8 },
    started_at: "2026-06-11T00:00:00.000Z",
    elapsed_ms: 1,
    ...overrides,
  };
}

describe("ledger io", () => {
  it("reads an empty ledger when the file is missing", () => {
    expect(readLedger(store)).toEqual({ schema_version: "0", runs: [] });
  });

  it("appends and reads back entries in order", () => {
    appendLedgerEntry(store, entry("a"));
    appendLedgerEntry(store, entry("b"));
    expect(readLedger(store).runs.map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("rejects a corrupt ledger with a clear error", () => {
    writeFileSync(join(store, "index.json"), "{nope");
    expect(() => readLedger(store)).toThrow(/corrupt run ledger/);
  });

  it("updates an entry in place", () => {
    appendLedgerEntry(store, entry("a"));
    updateLedgerEntry(store, entry("a", { elapsed_ms: 99 }));
    expect(readLedger(store).runs[0]?.elapsed_ms).toBe(99);
  });

  it("throws when updating an unknown id", () => {
    expect(() => updateLedgerEntry(store, entry("ghost"))).toThrow(/not found/);
  });

  it("removes entries by id and returns them", () => {
    appendLedgerEntry(store, entry("a"));
    appendLedgerEntry(store, entry("b"));
    const removed = removeLedgerEntries(store, new Set(["a"]));
    expect(removed.map((r) => r.id)).toEqual(["a"]);
    expect(readLedger(store).runs.map((r) => r.id)).toEqual(["b"]);
  });

  it("writes the file with a trailing newline (atomic tmp is gone)", () => {
    appendLedgerEntry(store, entry("a"));
    const raw = readFileSync(join(store, "index.json"), "utf8");
    expect(raw.endsWith("}\n")).toBe(true);
  });
});

describe("latestOkEntry", () => {
  it("returns the newest ok entry for a key, skipping failures", () => {
    appendLedgerEntry(store, entry("a", { run_key: "k1" }));
    appendLedgerEntry(store, entry("b", { run_key: "k1", status: "failed" }));
    appendLedgerEntry(store, entry("c", { run_key: "k2" }));
    const ledger = readLedger(store);
    expect(latestOkEntry(ledger, "k1")?.id).toBe("a");
    expect(latestOkEntry(ledger)?.id).toBe("c");
    expect(latestOkEntry(ledger, "k3")).toBeUndefined();
  });
});
