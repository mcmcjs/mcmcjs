import type { Ledger, LedgerEntry } from "@mcmcjs/core";
import { describe, expect, it } from "vitest";
import { formatRunsTable, pruneSelection } from "../src/runs";

function entry(id: string, overrides: Partial<LedgerEntry> = {}): LedgerEntry {
  return {
    id,
    run_key: "k",
    spec_hash: "s",
    status: "ok",
    model_path: "model.jl",
    data_sha256: "d",
    seed: 42,
    backend: { id: "turing", version: "release" },
    sampler: { algorithm: "NUTS", draws: 1000, warmup: 1000, chains: 4, adapt_delta: 0.8 },
    started_at: new Date().toISOString(),
    elapsed_ms: 22442,
    diagnostics: {
      converged: true,
      rhat_max: 1.006,
      ess_bulk_min: 1277,
      ess_tail_min: 1391,
      divergences: 0,
    },
    ...overrides,
  };
}

function ledgerOf(...runs: LedgerEntry[]): Ledger {
  return { schema_version: "0", runs };
}

describe("formatRunsTable", () => {
  it("explains an empty store", () => {
    expect(formatRunsTable(ledgerOf())).toContain("no runs yet");
  });

  it("lists newest first with refs, verdicts, and divergences", () => {
    const table = formatRunsTable(
      ledgerOf(
        entry("20260610-000000-aaaaaa"),
        entry("20260611-000000-bbbbbb", {
          status: "failed",
          error: "boom",
          diagnostics: undefined,
        }),
      ),
      false,
    );
    const lines = table.split("\n");
    expect(lines[0]).toMatch(/^ref\s+run\s+model\s+sampler\s+seed\s+verdict/);
    expect(lines[2]).toContain("@1");
    expect(lines[2]).toContain("20260611-000000-bbbbbb");
    expect(lines[2]).toContain("failed");
    expect(lines[3]).toContain("@2");
    expect(lines[3]).toContain("converged");
    expect(lines[3]).toContain("1000x4");
    expect(lines[3]).toMatch(/\s0\s/);
  });

  it("shows a dash when a run carries no divergence stat", () => {
    const table = formatRunsTable(
      ledgerOf(
        entry("20260610-000000-aaaaaa", {
          diagnostics: {
            converged: true,
            rhat_max: 1.0,
            ess_bulk_min: 500,
            ess_tail_min: 500,
            divergences: null,
          },
        }),
      ),
      false,
    );
    expect(table.split("\n")[2]).toMatch(/converged\s+-\s/);
  });
});

describe("pruneSelection", () => {
  it("selects everything older than the most recent keep runs", () => {
    const ledger = ledgerOf(entry("a"), entry("b"), entry("c"), entry("d"));
    expect(pruneSelection(ledger, 2).map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("never selects the newest runs, even failed ones", () => {
    const ledger = ledgerOf(
      entry("a"),
      entry("b"),
      entry("c", { status: "failed", error: "boom", diagnostics: undefined }),
    );
    expect(pruneSelection(ledger, 2).map((r) => r.id)).toEqual(["a"]);
  });

  it("selects nothing when under the limit", () => {
    expect(pruneSelection(ledgerOf(entry("a")), 5)).toEqual([]);
  });

  it("rejects a negative keep", () => {
    expect(() => pruneSelection(ledgerOf(), -1)).toThrow(/>= 0/);
  });
});
