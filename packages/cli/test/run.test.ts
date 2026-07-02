import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_JULIA_CHANNEL, type LedgerEntry, serializeSpecToml } from "@mcmcjs/core";
import type { DrawBatch } from "@mcmcjs/engine";
import { describe, expect, it, vi } from "vitest";
import type { DiagnosticsReport } from "../src/diagnose";
import {
  autoDetectDataFile,
  buildRunConfig,
  canReuse,
  detectBackend,
  diagnosticsSummary,
  frozenSpecFor,
  makeDrawsSink,
  type RunInputs,
  refitReasons,
} from "../src/run";

const tmp = (): string => mkdtempSync(join(tmpdir(), "mcmcjs-run-"));

const TURING_MODEL = "using Turing\n@model function f() end\nbuild_model(data) = f()\n";

function writeModel(dir: string, name = "model.jl"): string {
  const path = join(dir, name);
  writeFileSync(path, TURING_MODEL);
  return path;
}

const GRAPH = JSON.stringify({
  name: "Demo",
  elements: [
    {
      id: "mu",
      name: "mu",
      type: "node",
      nodeType: "stochastic",
      distribution: "dnorm",
      param1: "0",
      param2: "1",
    },
  ],
  dataContent: JSON.stringify({ data: { N: 1 }, inits: {} }),
  version: 1,
});

describe("detectBackend", () => {
  it("detects JuliaBUGS from imports or the bugs macro", () => {
    expect(detectBackend("import JuliaBUGS\nbuild_model(data) = ...")).toBe("juliabugs");
    expect(detectBackend("const model_def = JuliaBUGS.@bugs begin end")).toBe("juliabugs");
  });

  it("detects Turing from the model macro or using statement", () => {
    expect(detectBackend("using Turing\n@model function f() end")).toBe("turing");
  });

  it("returns undefined when no marker is present", () => {
    expect(detectBackend("f(x) = x + 1")).toBeUndefined();
  });
});

describe("autoDetectDataFile", () => {
  it("prefers a model-named CSV over the generic data.csv", () => {
    const dir = tmp();
    const model = writeModel(dir);
    writeFileSync(join(dir, "data.csv"), "x\n1\n");
    writeFileSync(join(dir, "model.csv"), "x\n2\n");
    expect(autoDetectDataFile(model)).toBe(join(dir, "model.csv"));
  });

  it("returns undefined when nothing matches", () => {
    const dir = tmp();
    expect(autoDetectDataFile(join(dir, "model.jl"))).toBeUndefined();
  });
});

describe("makeDrawsSink", () => {
  const batch = (chain: number, seq: number): DrawBatch => ({
    chain,
    seq,
    iteration: seq + 1,
    draws: { mu: [seq] },
  });

  it("truncates on creation and appends one NDJSON batch per line", () => {
    const path = join(tmp(), "draws.ndjson");
    writeFileSync(path, "stale\n");
    const sink = makeDrawsSink(path);
    sink(batch(0, 0));
    sink(batch(0, 1));
    const lines = readFileSync(path, "utf8").trim().split("\n");
    expect(lines.map((l) => JSON.parse(l))).toEqual([batch(0, 0), batch(0, 1)]);
  });

  it("degrades to a one-time warning when the path cannot be written", () => {
    const dir = tmp();
    // A directory standing where the file should be makes every write fail.
    const path = join(dir, "draws");
    mkdirSync(path);
    const warn = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    const sink = makeDrawsSink(path);
    expect(() => {
      sink(batch(0, 0));
      sink(batch(0, 1));
    }).not.toThrow();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain("cannot write draws");
    warn.mockRestore();
  });
});

describe("buildRunConfig: model file with no spec", () => {
  it("builds defaults, detects the backend, and never writes a sibling spec", () => {
    const dir = tmp();
    const model = writeModel(dir);
    const config = buildRunConfig(model, {});
    expect(config.specSource).toBe("defaults");
    expect(config.spec.backend.id).toBe("turing");
    expect(config.spec.sampler).toMatchObject({ draws: 1000, warmup: 1000, chains: 4 });
    expect(config.spec.seed).toBeGreaterThanOrEqual(0);
    expect(config.modelPath).toBe(model);
    expect(existsSync(join(dir, "model.toml"))).toBe(false);
  });

  it("honors flags and references --data by path (not inlined)", () => {
    const dir = tmp();
    const model = writeModel(dir);
    const dataPath = join(dir, "data.csv");
    writeFileSync(dataPath, "x,y\n1,2\n3,4\n");
    const config = buildRunConfig(model, {
      draws: 250,
      warmup: 100,
      chains: 2,
      seed: 7,
      adaptDelta: 0.95,
      data: dataPath,
    });
    expect(config.spec.sampler).toMatchObject({
      draws: 250,
      warmup: 100,
      chains: 2,
      adapt_delta: 0.95,
    });
    expect(config.spec.seed).toBe(7);
    // --data is recorded as a reference; the contents are loaded at run time.
    expect(config.dataFile).toBe(dataPath);
    expect(config.spec.data).toEqual({});
  });

  it("auto-detects a sibling data.csv when no --data is given", () => {
    const dir = tmp();
    const model = writeModel(dir);
    const dataPath = join(dir, "data.csv");
    writeFileSync(dataPath, "x,y\n1,2\n3,4\n");
    const config = buildRunConfig(model, {});
    expect(config.dataFile).toBe(dataPath);
    expect(config.notes.some((n) => n.includes("using data from"))).toBe(true);
  });

  it("does not auto-detect when there is no sibling data file", () => {
    const dir = tmp();
    const model = writeModel(dir);
    const config = buildRunConfig(model, {});
    expect(config.dataFile).toBeUndefined();
    expect(config.notes).toEqual([]);
  });

  it("lets --data win over an auto-detectable sibling", () => {
    const dir = tmp();
    const model = writeModel(dir);
    writeFileSync(join(dir, "data.csv"), "x,y\n1,2\n");
    const chosen = join(dir, "other.csv");
    writeFileSync(chosen, "x,y\n9,9\n");
    const config = buildRunConfig(model, { data: chosen });
    expect(config.dataFile).toBe(chosen);
  });

  it("fails fast on invalid settings", () => {
    const dir = tmp();
    const model = writeModel(dir);
    expect(() => buildRunConfig(model, { draws: -5 })).toThrow(/invalid run settings/);
  });

  it("asks for --backend when detection fails", () => {
    const dir = tmp();
    const path = join(dir, "model.jl");
    writeFileSync(path, "f(x) = x + 1");
    expect(() => buildRunConfig(path, {})).toThrow(/--backend/);
  });
});

describe("buildRunConfig: sibling spec", () => {
  function writeSibling(dir: string, overrides: Record<string, unknown> = {}): string {
    const specPath = join(dir, "model.toml");
    writeFileSync(
      specPath,
      serializeSpecToml({
        schema_version: "0",
        seed: 11,
        backend: { id: "turing" },
        model: { kind: "file", path: "./model.jl" },
        sampler: { algorithm: "NUTS", draws: 500, warmup: 200, chains: 2 },
        data: { N: 1 },
        ...overrides,
      }),
    );
    return specPath;
  }

  it("uses the sibling's settings when no flags are given", () => {
    const dir = tmp();
    const model = writeModel(dir);
    writeSibling(dir);
    const config = buildRunConfig(model, {});
    expect(config.specSource).toBe("sibling");
    expect(config.spec.seed).toBe(11);
    expect(config.spec.sampler.draws).toBe(500);
    expect(config.notes.join("\n")).toContain("flags override");
  });

  it("lets flags override the sibling instead of rejecting them", () => {
    const dir = tmp();
    const model = writeModel(dir);
    writeSibling(dir);
    const config = buildRunConfig(model, { draws: 4000, seed: 9 });
    expect(config.spec.sampler.draws).toBe(4000);
    expect(config.spec.sampler.warmup).toBe(200);
    expect(config.spec.seed).toBe(9);
  });

  it("forces the model named on the command line over the spec's model.path", () => {
    const dir = tmp();
    const model = writeModel(dir);
    writeModel(dir, "other.jl");
    writeSibling(dir, { model: { kind: "file", path: "./other.jl" } });
    const config = buildRunConfig(model, {});
    expect(config.spec.model.path).toBe("./model.jl");
    expect(config.modelPath).toBe(model);
  });
});

describe("buildRunConfig: spec input", () => {
  it("applies flag overrides on top of the spec", () => {
    const dir = tmp();
    writeModel(dir);
    const specPath = join(dir, "spec.toml");
    writeFileSync(
      specPath,
      serializeSpecToml({
        schema_version: "0",
        seed: 1,
        backend: { id: "turing" },
        model: { kind: "file", path: "./model.jl" },
        sampler: { algorithm: "NUTS", draws: 10, warmup: 10, chains: 1 },
        data: {},
      }),
    );
    const config = buildRunConfig(specPath, { chains: 8 });
    expect(config.specSource).toBe("input");
    expect(config.spec.sampler.chains).toBe(8);
    expect(config.spec.sampler.draws).toBe(10);
  });

  it("uses --julia-version as the channel without persisting it", () => {
    const dir = tmp();
    writeModel(dir);
    const specPath = join(dir, "spec.toml");
    writeFileSync(
      specPath,
      serializeSpecToml({
        schema_version: "0",
        seed: 1,
        backend: { id: "turing" },
        model: { kind: "file", path: "./model.jl" },
        sampler: { algorithm: "NUTS", draws: 10 },
        data: {},
      }),
    );
    const config = buildRunConfig(specPath, { juliaVersion: "1.10" });
    expect(config.channel).toBe("1.10");
    expect(config.spec.backend.version).toBe(DEFAULT_JULIA_CHANNEL);
  });
});

describe("buildRunConfig: graph input", () => {
  it("converts once, then reuses the written spec with flag overrides", () => {
    const dir = tmp();
    const graphPath = join(dir, "demo.json");
    writeFileSync(graphPath, GRAPH);

    const first = buildRunConfig(graphPath, { seed: 5, draws: 250 });
    expect(first.spec.seed).toBe(5);
    expect(first.spec.sampler.draws).toBe(250);
    expect(existsSync(join(dir, "demo.jl"))).toBe(true);
    expect(existsSync(join(dir, "demo.toml"))).toBe(true);

    const second = buildRunConfig(graphPath, { draws: 999 });
    expect(second.spec.sampler.draws).toBe(999);
    expect(second.spec.seed).toBe(5);
    expect(second.notes.join("\n")).toContain("using settings from");
  });

  it("rejects flags that cannot apply to a graph", () => {
    const dir = tmp();
    const graphPath = join(dir, "demo.json");
    writeFileSync(graphPath, GRAPH);
    expect(() => buildRunConfig(graphPath, { backend: "turing" })).toThrow(
      /does not apply to a graph/,
    );
  });

  it("names the file when JSON input is malformed", () => {
    const dir = tmp();
    const path = join(dir, "broken.json");
    writeFileSync(path, "{not json");
    expect(() => buildRunConfig(path, {})).toThrow(/invalid JSON in .*broken\.json/);
  });
});

const SAMPLER = { algorithm: "NUTS", draws: 1000, warmup: 1000, chains: 4, adapt_delta: 0.8 };

function ledgerEntry(overrides: Partial<LedgerEntry> = {}): LedgerEntry {
  return {
    id: "20260611-000000-aaaaaa",
    run_key: "k",
    spec_hash: "s",
    status: "ok",
    model_path: "model.jl",
    model_sha256: "m1",
    data_sha256: "d1",
    seed: 42,
    backend: { id: "turing", version: "release" },
    sampler: SAMPLER,
    started_at: "2026-06-11T00:00:00.000Z",
    elapsed_ms: 1,
    ...overrides,
  };
}

describe("canReuse", () => {
  const prior = ledgerEntry({ seed: 42 });

  it("reuses any prior seed when the seed is unpinned", () => {
    expect(canReuse(prior, 999, false)).toBe(true);
  });

  it("requires a pinned seed to match", () => {
    expect(canReuse(prior, 42, true)).toBe(true);
    expect(canReuse(prior, 43, true)).toBe(false);
  });

  it("never reuses without a prior run", () => {
    expect(canReuse(undefined, 42, false)).toBe(false);
  });
});

describe("refitReasons", () => {
  const next: RunInputs = {
    model_sha256: "m1",
    data_sha256: "d1",
    sampler: SAMPLER,
    channel: "release",
    seed: 42,
  };

  it("is empty when nothing changed", () => {
    expect(refitReasons(ledgerEntry(), next, true)).toEqual([]);
  });

  it("names each changed input", () => {
    const prev = ledgerEntry({
      model_sha256: "m0",
      data_sha256: "d0",
      sampler: { ...SAMPLER, draws: 500 },
      backend: { id: "turing", version: "1.10" },
      seed: 7,
    });
    expect(refitReasons(prev, next, true)).toEqual([
      "the model changed",
      "the data changed",
      "draws 500 -> 1000",
      "runtime 1.10 -> release",
      "seed 7 -> 42",
    ]);
  });

  it("ignores the seed when it is unpinned", () => {
    expect(refitReasons(ledgerEntry({ seed: 7 }), next, false)).toEqual([]);
  });
});

describe("frozenSpecFor", () => {
  it("pins the channel and points model.path at the snapshot", () => {
    const dir = tmp();
    const model = writeModel(dir);
    const config = buildRunConfig(model, { seed: 1 });
    const frozen = frozenSpecFor(config.spec, "1.10", "model.jl");
    expect(frozen.backend.version).toBe("1.10");
    expect(frozen.model.path).toBe("./model.jl");
    expect(frozen.seed).toBe(1);
    expect(config.spec.backend.version).toBe(DEFAULT_JULIA_CHANNEL);
  });
});

describe("diagnosticsSummary", () => {
  it("condenses a report into ledger fields", () => {
    const report = {
      converged: false,
      divergences: 3,
      variables: [
        { rhat: 1.01, essBulk: 900, essTail: 800 },
        { rhat: 1.2, essBulk: 120, essTail: 1500 },
      ],
    } as unknown as DiagnosticsReport;
    expect(diagnosticsSummary(report)).toEqual({
      converged: false,
      rhat_max: 1.2,
      ess_bulk_min: 120,
      ess_tail_min: 800,
      divergences: 3,
    });
  });

  it("maps non-finite diagnostics to null", () => {
    const report = {
      converged: false,
      divergences: null,
      variables: [{ rhat: Number.NaN, essBulk: Number.NaN, essTail: Number.NaN }],
    } as unknown as DiagnosticsReport;
    expect(diagnosticsSummary(report)).toEqual({
      converged: false,
      rhat_max: null,
      ess_bulk_min: null,
      ess_tail_min: null,
      divergences: null,
    });
  });
});
