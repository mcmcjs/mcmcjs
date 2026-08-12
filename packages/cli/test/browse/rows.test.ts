import type { LedgerEntry } from "@mcmcjs/core";
import { describe, expect, it } from "vitest";
import {
  filterPickables,
  languageOf,
  type ModelItem,
  matches,
  modelPickables,
  type RunItem,
  runPickables,
  sparkline,
  toneOf,
  type VariableRow,
  variablePickables,
} from "../../src/browse/rows";

const NOW = Date.parse("2026-08-13T12:00:00Z");

function entry(over: Partial<LedgerEntry> = {}): LedgerEntry {
  return {
    id: "20260813-100000-abcdef",
    run_key: "key",
    spec_hash: "hash",
    status: "ok",
    model_path: "model.jl",
    data_sha256: "data",
    seed: 42,
    backend: { id: "turing", version: "1.12.6" },
    sampler: { algorithm: "NUTS", draws: 1000, warmup: 1000, chains: 4, adapt_delta: 0.8 },
    started_at: "2026-08-13T10:00:00Z",
    elapsed_ms: 12_000,
    diagnostics: {
      converged: true,
      rhat_max: 1.001,
      ess_bulk_min: 900,
      ess_tail_min: 850,
      divergences: 0,
    },
    ...over,
  };
}

const runItem = (over: Partial<LedgerEntry> = {}, ref = "@1"): RunItem => ({
  kind: "run",
  ref,
  entry: entry(over),
});

describe("runPickables", () => {
  it("shows the ref, model, sampler, verdict, and age", () => {
    const [row] = runPickables([runItem()], NOW);
    expect(row?.row.label).toBe("@1  model.jl  NUTS 1000x4");
    expect(row?.row.hint).toBe("converged · 2h ago");
    expect(row?.row.tone).toBe("good");
  });

  it("pads the ref and model columns so rows line up", () => {
    const rows = runPickables(
      [runItem({}, "@1"), runItem({ model_path: "much-longer-name.jl" }, "@10")],
      NOW,
    );
    const [first, second] = rows;
    expect(first?.row.label.indexOf("NUTS")).toBe(second?.row.label.indexOf("NUTS"));
  });

  it("matches on ref, id, model, sampler, backend, and verdict", () => {
    const [row] = runPickables([runItem({ status: "failed" })], NOW);
    const search = row?.search ?? "";
    for (const term of ["@1", "abcdef", "model.jl", "nuts", "turing", "failed"]) {
      expect(matches(search, term)).toBe(true);
    }
    expect(matches(search, "stan")).toBe(false);
  });

  it("reads a failed or cancelled run as such, before diagnostics", () => {
    expect(runPickables([runItem({ status: "failed" })], NOW)[0]?.row.tone).toBe("bad");
    expect(runPickables([runItem({ status: "cancelled" })], NOW)[0]?.row.tone).toBe("warn");
    const unconverged = runItem({
      diagnostics: {
        converged: false,
        rhat_max: 1.3,
        ess_bulk_min: 12,
        ess_tail_min: 10,
        divergences: 4,
      },
    });
    expect(runPickables([unconverged], NOW)[0]?.row.hint).toContain("not converged");
  });
});

describe("modelPickables", () => {
  const model = (over: Partial<ModelItem> = {}): ModelItem => ({
    kind: "model",
    path: "/p/model.jl",
    label: "model.jl",
    language: "julia",
    runs: 3,
    ...over,
  });

  it("counts runs, singular and plural", () => {
    expect(modelPickables([model()])[0]?.row.hint).toBe("julia · 3 runs");
    expect(modelPickables([model({ runs: 1 })])[0]?.row.hint).toBe("julia · 1 run");
    expect(modelPickables([model({ runs: 0 })])[0]?.row.hint).toBe("julia · 0 runs");
  });
});

describe("matches and filterPickables", () => {
  it("needs every term, in any order, ignoring case", () => {
    expect(matches("alpha beta gamma", "BETA alpha")).toBe(true);
    expect(matches("alpha beta", "alpha delta")).toBe(false);
    expect(matches("alpha", "")).toBe(true);
  });

  it("returns everything for a blank query", () => {
    const items = runPickables([runItem({}, "@1"), runItem({ model_path: "b.jl" }, "@2")], NOW);
    expect(filterPickables(items, "   ")).toHaveLength(2);
    expect(filterPickables(items, "b.jl")).toHaveLength(1);
  });
});

describe("sparkline", () => {
  it("draws a rising series as rising blocks", () => {
    const spark = sparkline([1, 2, 3, 4, 5, 6, 7, 8], 8);
    expect(spark).toBe("▁▂▃▄▅▆▇█");
  });

  it("draws a stuck chain flat, which is the point of showing it", () => {
    expect(sparkline([3, 3, 3, 3], 4)).toBe("▁▁▁▁");
  });

  it("averages into the requested width and survives short or empty input", () => {
    expect(sparkline([1, 2, 3, 4, 5, 6, 7, 8], 4)).toHaveLength(4);
    expect(sparkline([1, 2], 8)).toHaveLength(2);
    expect(sparkline([], 8)).toBe("");
    expect(sparkline([1, 2, 3], 0)).toBe("");
  });

  it("ignores non-finite draws", () => {
    expect(sparkline([Number.NaN, 1, 2, Number.POSITIVE_INFINITY, 3], 3)).toBe("▁▅█");
  });
});

describe("variablePickables", () => {
  const row = (over: Partial<VariableRow> = {}): VariableRow => ({
    variable: "mu",
    mean: 5.0061,
    std: 0.0862,
    rhat: 1.001,
    essBulk: 903.2,
    spark: "▁▄█",
    ...over,
  });

  it("summarises the variable and flags a bad R-hat", () => {
    const [ok] = variablePickables([row()]);
    expect(ok?.row.label).toBe("mu  ▁▄█");
    expect(ok?.row.hint).toBe("mean 5.006 · sd 0.086 · R-hat 1.001 · ESS 903");
    expect(ok?.row.tone).toBe("plain");
    expect(variablePickables([row({ rhat: 1.2 })])[0]?.row.tone).toBe("bad");
  });

  it("prints n/a for a diagnostic that could not be computed", () => {
    expect(variablePickables([row({ rhat: Number.NaN })])[0]?.row.hint).toContain("R-hat n/a");
  });
});

describe("toneOf and languageOf", () => {
  it("colors verdicts by outcome", () => {
    expect(toneOf("converged")).toBe("good");
    expect(toneOf("not converged")).toBe("bad");
    expect(toneOf("failed")).toBe("bad");
    expect(toneOf("cancelled")).toBe("warn");
    expect(toneOf("-")).toBe("plain");
  });

  it("names the language from the extension", () => {
    expect(languageOf("/p/model.jl")).toBe("julia");
    expect(languageOf("/p/model.stan")).toBe("stan");
    expect(languageOf("/p/spec.toml")).toBe("spec");
    expect(languageOf("/p/README")).toBe("model");
  });
});
