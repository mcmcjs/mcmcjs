import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendLedgerEntry, ensureStore, type LedgerEntry } from "@mcmcjs/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveSamplesPath } from "../src/diagnose";

let dir: string;
let store: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "mcmcjs-diag-"));
  store = join(dir, ".mcmc");
  ensureStore(store);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function addRun(id: string, status: "ok" | "failed", withSamples: boolean): void {
  const entry: LedgerEntry = {
    id,
    run_key: "k",
    spec_hash: "s",
    status,
    model_path: "model.jl",
    data_sha256: "d",
    seed: 1,
    backend: { id: "turing", version: "release" },
    sampler: { algorithm: "NUTS", draws: 10, warmup: 10, chains: 1, adapt_delta: 0.8 },
    started_at: "2026-06-11T00:00:00.000Z",
    elapsed_ms: 1,
  };
  appendLedgerEntry(store, entry);
  const runPath = join(store, "runs", id);
  mkdirSync(runPath, { recursive: true });
  if (withSamples) writeFileSync(join(runPath, "samples.json"), "{}");
}

describe("resolveSamplesPath", () => {
  it("passes an existing file through untouched", () => {
    const file = join(dir, "out.json");
    writeFileSync(file, "{}");
    expect(resolveSamplesPath(file, store)).toBe(file);
  });

  it("reports a path-shaped missing target as a missing file, not a bad ref", () => {
    expect(() => resolveSamplesPath(join(dir, "typo.json"), store)).toThrow(
      /samples file not found/,
    );
    expect(() => resolveSamplesPath("typo.json", store)).toThrow(/samples file not found/);
  });

  it("resolves refs against the store, defaulting to the latest run", () => {
    addRun("20260610-000000-aaaaaa", "ok", true);
    addRun("20260611-000000-bbbbbb", "ok", true);
    expect(resolveSamplesPath(undefined, store)).toBe(
      join(store, "runs", "20260611-000000-bbbbbb", "samples.json"),
    );
    expect(resolveSamplesPath("@2", store)).toBe(
      join(store, "runs", "20260610-000000-aaaaaa", "samples.json"),
    );
  });

  it("explains a run without samples", () => {
    addRun("20260611-000000-cccccc", "failed", false);
    expect(() => resolveSamplesPath("latest", store)).toThrow(/has no samples.*fit failed/);
  });
});
