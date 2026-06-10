import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LedgerEntry, RunRecord } from "@mcmcjs/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { formatRunDetail } from "../src/show";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "mcmcjs-show-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const entry: LedgerEntry = {
  id: "20260611-104210-a1b2c3",
  run_key: "k",
  spec_hash: "s",
  status: "ok",
  model_path: "model.jl",
  model_sha256: "08bf6f6145a3e8e3",
  data_sha256: "ad94130bcf6745a5",
  seed: 42,
  backend: { id: "turing", version: "release" },
  sampler: { algorithm: "NUTS", draws: 1000, warmup: 1000, chains: 4, adapt_delta: 0.8 },
  julia: "1.12.6",
  started_at: "2026-06-10T16:51:08.310Z",
  elapsed_ms: 22442,
  diagnostics: {
    converged: true,
    rhat_max: 1.006,
    ess_bulk_min: 1277,
    ess_tail_min: 1391,
    divergences: 0,
  },
};

const record = {
  schema_version: "0",
  spec_hash: "s",
  seed: 42,
  backend: { id: "turing", runtime: "julia" },
  runtime: { requested: "release", actual: "1.12.6" },
  packages: { Turing: "0.45.0", DynamicPPL: "0.41.8" },
  samples_file: "x",
  started_at: "2026-06-10T16:51:08.310Z",
  elapsed_ms: 22442,
} as RunRecord;

describe("formatRunDetail", () => {
  it("renders settings, provenance, verdict, and artifact paths", () => {
    const runPath = join(dir, "runs", entry.id);
    mkdirSync(runPath, { recursive: true });
    writeFileSync(join(runPath, "samples.json"), "{}");
    writeFileSync(join(runPath, "spec.toml"), "");

    const text = formatRunDetail(entry, runPath, record);
    expect(text).toContain("run 20260611-104210-a1b2c3");
    expect(text).toContain("model.jl (sha256 08bf6f6145a3)");
    expect(text).toContain("turing on Julia release (ran 1.12.6)");
    expect(text).toContain("NUTS, 4 chains x 1000 draws + 1000 warmup, adapt_delta 0.8, seed 42");
    expect(text).toContain("R-hat max 1.006");
    expect(text).toContain("Turing 0.45.0");
    expect(text).toContain(join(runPath, "samples.json"));
    expect(text).toContain(join(runPath, "spec.toml"));
    expect(text).not.toContain(join(runPath, "run.json"));
  });

  it("renders a failed run with its error", () => {
    const failed: LedgerEntry = {
      ...entry,
      status: "failed",
      error: "model did not compile",
      diagnostics: undefined,
    };
    const text = formatRunDetail(failed, join(dir, "missing"), undefined);
    expect(text).toContain("failed: model did not compile");
  });
});
