import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LedgerEntry } from "@mcmcjs/core";
import { compareLoo } from "@mcmcjs/diagnostics";
import type { EngineContext } from "@mcmcjs/engine";
import { describe, expect, it } from "vitest";
import {
  buildLooReport,
  ensureLogLik,
  formatCompareHuman,
  formatLooHuman,
  type LooReport,
} from "../src/loo";

const ctx: EngineContext = {
  run: async () => {
    throw new Error("no engine in unit tests");
  },
  platform: "linux",
};

/** A samples wire with the given columns, values varying by draw and chain. */
function wire(parameters: string[], nDraws = 80, nChains = 2, shift = 0): string {
  const total = parameters.length;
  const flat: number[] = new Array(nDraws * total * nChains);
  for (let c = 0; c < nChains; c++) {
    for (let p = 0; p < total; p++) {
      for (let i = 0; i < nDraws; i++) {
        const noise = Math.sin(i * 0.7 + p * 1.3 + c * 2.1) * 0.4;
        flat[i + p * nDraws + c * nDraws * total] = -1.2 - 0.1 * p + noise - shift;
      }
    }
  }
  return JSON.stringify({
    size: [nDraws, total, nChains],
    value_flat: flat,
    parameters,
    name_map: { parameters, internals: [] },
  });
}

function entryFor(id: string, backend = "turing"): LedgerEntry {
  return {
    id,
    run_key: "k",
    spec_hash: "h",
    status: "ok",
    model_path: "model.jl",
    data_sha256: "d",
    seed: 1,
    backend: { id: backend, version: "release" },
    sampler: { algorithm: "NUTS", draws: 80, warmup: 10, chains: 2, adapt_delta: 0.8 },
    started_at: new Date().toISOString(),
    elapsed_ms: 5,
  };
}

function makeStore(): string {
  const storeDir = mkdtempSync(join(tmpdir(), "mcmc-loo-store-"));
  writeFileSync(join(storeDir, "index.json"), JSON.stringify({ schema_version: "0", runs: [] }));
  return storeDir;
}

function addRun(storeDir: string, entry: LedgerEntry, files: Record<string, string>): void {
  const dir = join(storeDir, "runs", entry.id);
  mkdirSync(dir, { recursive: true });
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
}

describe("ensureLogLik", () => {
  it("reads log_lik columns straight from the samples (the Stan convention)", async () => {
    const storeDir = makeStore();
    const entry = entryFor("20260807-000000-aaa111", "stan");
    addRun(storeDir, entry, {
      "samples.json": wire(["mu", "log_lik[1]", "log_lik[2]", "log_lik[3]"]),
    });
    const src = await ensureLogLik(storeDir, entry, ctx, {});
    expect(src.source).toBe("samples");
    expect(src.observations).toEqual(["log_lik[1]", "log_lik[2]", "log_lik[3]"]);
    expect(src.pointwise).toHaveLength(3);
    expect(src.pointwise[0]).toHaveLength(2);
    expect(src.pointwise[0]?.[0]).toHaveLength(80);
  });

  it("uses the cached loglik.json when its record matches the samples", async () => {
    const storeDir = makeStore();
    const entry = entryFor("20260807-000000-bbb222");
    const samplesText = wire(["mu", "sigma"]);
    const loglikText = wire(["y[1]", "y[2]", "y[3]", "y[4]"]);
    addRun(storeDir, entry, {
      "samples.json": samplesText,
      "loglik.json": loglikText,
      "loglik.json.run.json": JSON.stringify({
        schema_version: "0",
        posterior_samples_sha256: createHash("sha256").update(samplesText).digest("hex"),
      }),
    });
    const src = await ensureLogLik(storeDir, entry, ctx, {});
    expect(src.source).toBe("cache");
    expect(src.observations).toEqual(["y[1]", "y[2]", "y[3]", "y[4]"]);
  });

  it("ignores a stale cache and refuses a Stan run without log_lik columns", async () => {
    const storeDir = makeStore();
    const entry = entryFor("20260807-000000-ccc333", "stan");
    addRun(storeDir, entry, {
      "samples.json": wire(["mu"]),
      "loglik.json": wire(["y[1]"]),
      "loglik.json.run.json": JSON.stringify({
        schema_version: "0",
        posterior_samples_sha256: "not-the-right-hash",
      }),
    });
    await expect(ensureLogLik(storeDir, entry, ctx, {})).rejects.toThrow(/generated quantities/);
  });

  it("fails clearly when the run has no samples", async () => {
    const storeDir = makeStore();
    const entry = entryFor("20260807-000000-ddd444");
    mkdirSync(join(storeDir, "runs", entry.id), { recursive: true });
    await expect(ensureLogLik(storeDir, entry, ctx, {})).rejects.toThrow(/no samples/);
  });
});

describe("buildLooReport and formatting", () => {
  function reportFor(shift = 0): LooReport {
    const samples = wire(
      ["log_lik[1]", "log_lik[2]", "log_lik[3]", "log_lik[4]", "log_lik[5]"],
      120,
      2,
      shift,
    );
    const parsed = JSON.parse(samples) as { parameters: string[] };
    const names = parsed.parameters;
    const nDraws = 120;
    const flat = (JSON.parse(samples) as { value_flat: number[] }).value_flat;
    const pointwise = names.map((_, p) =>
      [0, 1].map(
        (c) =>
          new Float64Array(
            Array.from(
              { length: nDraws },
              (_, i) => flat[i + p * nDraws + c * nDraws * names.length] as number,
            ),
          ),
      ),
    );
    return buildLooReport({
      pointwise,
      observations: names,
      source: "samples",
      label: `model-${shift}`,
    });
  }

  it("produces finite estimates with a k-hat verdict", () => {
    const report = reportFor();
    expect(Number.isFinite(report.loo.elpd)).toBe(true);
    expect(Number.isFinite(report.waic.elpd)).toBe(true);
    expect(report.loo.elpd).toBeLessThanOrEqual(report.waic.elpd + 1);
    expect(report.reff).toBeGreaterThan(0);
    expect(report.reff).toBeLessThanOrEqual(1);
    const text = formatLooHuman(report);
    expect(text).toContain("elpd_loo");
    expect(text).toContain("Pareto k:");
    expect(text).toContain("5 observations");
  });

  it("ranks a shifted model below the original in the comparison table", () => {
    const a = reportFor(0);
    const b = reportFor(0.8);
    const ranked = compareLoo([
      { name: b.label, result: b.loo },
      { name: a.label, result: a.loo },
    ]);
    expect(ranked[0]?.name).toBe("model-0");
    expect(ranked[1]?.elpdDiff).toBeCloseTo(-0.8 * 5, 5);
    const table = formatCompareHuman(
      ranked,
      new Map([
        [a.label, a],
        [b.label, b],
      ]),
    );
    expect(table).toContain("elpd_diff");
    expect(table.indexOf("model-0")).toBeLessThan(table.indexOf("model-0.8"));
  });
});
