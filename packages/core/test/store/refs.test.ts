import { describe, expect, it } from "vitest";
import type { Ledger, LedgerEntry } from "../../src/store/ledger";
import { computeRunKey, makeRunId, resolveRunRef } from "../../src/store/refs";

const sampler = { algorithm: "NUTS", draws: 1000, warmup: 1000, chains: 4, adapt_delta: 0.8 };

function keyParts(overrides: Record<string, unknown> = {}) {
  return {
    backend: { id: "turing", version: "release" },
    model_sha256: "m1",
    entry: "build_model",
    sampler,
    data_sha256: "d1",
    ...overrides,
  };
}

describe("computeRunKey", () => {
  it("is stable across key order", () => {
    const a = computeRunKey(keyParts());
    const b = computeRunKey({
      data_sha256: "d1",
      sampler,
      entry: "build_model",
      model_sha256: "m1",
      backend: { version: "release", id: "turing" },
    });
    expect(a).toBe(b);
  });

  it("changes when a setting changes", () => {
    const base = computeRunKey(keyParts());
    expect(computeRunKey(keyParts({ sampler: { ...sampler, draws: 2000 } }))).not.toBe(base);
    expect(computeRunKey(keyParts({ model_sha256: "m2" }))).not.toBe(base);
    expect(computeRunKey(keyParts({ data_sha256: "d2" }))).not.toBe(base);
  });
});

describe("makeRunId", () => {
  it("formats a sortable UTC stamp plus a key prefix", () => {
    const id = makeRunId(new Date("2026-06-11T10:42:10.123Z"), "a1b2c3deadbeef");
    expect(id).toBe("20260611-104210-a1b2c3");
  });
});

function ledgerOf(...ids: string[]): Ledger {
  return {
    schema_version: "0",
    runs: ids.map(
      (id): LedgerEntry => ({
        id,
        run_key: "k",
        spec_hash: "s",
        status: "ok",
        model_path: "model.jl",
        data_sha256: "d",
        seed: 1,
        backend: { id: "turing", version: "release" },
        sampler,
        started_at: "2026-06-11T00:00:00.000Z",
        elapsed_ms: 1,
      }),
    ),
  };
}

describe("resolveRunRef", () => {
  const ledger = ledgerOf(
    "20260601-000000-aaaaaa",
    "20260602-000000-bbbbbb",
    "20260603-000000-cccccc",
  );

  it("defaults to the newest run", () => {
    expect(resolveRunRef(ledger).id).toBe("20260603-000000-cccccc");
    expect(resolveRunRef(ledger, "latest").id).toBe("20260603-000000-cccccc");
  });

  it("resolves @N ordinals, newest first", () => {
    expect(resolveRunRef(ledger, "@1").id).toBe("20260603-000000-cccccc");
    expect(resolveRunRef(ledger, "@3").id).toBe("20260601-000000-aaaaaa");
    expect(() => resolveRunRef(ledger, "@4")).toThrow(/does not exist/);
  });

  it("resolves unique id prefixes and rejects short or ambiguous ones", () => {
    expect(resolveRunRef(ledger, "20260602").id).toBe("20260602-000000-bbbbbb");
    expect(() => resolveRunRef(ledger, "202")).toThrow(/too short/);
    expect(() => resolveRunRef(ledger, "20260")).toThrow(/ambiguous/);
    expect(() => resolveRunRef(ledger, "zzzz")).toThrow(/no run matches/);
  });

  it("explains an empty store", () => {
    expect(() => resolveRunRef(ledgerOf())).toThrow(/no runs in the store/);
  });
});
