import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LedgerEntry } from "@mcmcjs/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { findStores, modelItems, runItems, scanModels } from "../../src/browse";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "mcmcjs-browse-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function file(relative: string, contents = ""): string {
  const path = join(dir, relative);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, contents);
  return path;
}

const MODEL = "using Turing\n@model function m(y)\n  y ~ Normal()\nend\n";
const SPEC = [
  'schema_version = "0"',
  "seed = 1",
  "[backend]",
  'id = "turing"',
  "[model]",
  'kind = "file"',
  'path = "./m.jl"',
  "[sampler]",
  "draws = 10",
].join("\n");

describe("scanModels", () => {
  it("finds model files and specs, and nothing else", () => {
    file("model.jl", MODEL);
    file("model.stan", "parameters { real mu; }\nmodel { mu ~ normal(0,1); }");
    file("spec.toml", SPEC);
    file("notes.md", "# hi");
    file("config.toml", "[tool]\nvalue = 1");
    const found = scanModels(dir).map((path) => path.slice(dir.length + 1));
    expect(found.sort()).toEqual(["model.jl", "model.stan", "spec.toml"]);
  });

  // The reason content decides: a Julia library is full of .jl files that are
  // not models, and listing all of them buries the ones that are.
  it("ignores Julia source that declares no model", () => {
    file("model.jl", MODEL);
    file("src/Inference.jl", "module Inference\nusing AbstractMCMC\nstruct Emcee end\nend\n");
    file("docs/make.jl", 'using Documenter\nmakedocs(sitename = "x")\n');
    file("test/runtests.jl", 'using Test\n@testset "x" begin\nend\n');
    const found = scanModels(dir).map((path) => path.slice(dir.length + 1));
    expect(found).toEqual(["model.jl"]);
  });

  // A run bundle carries a schema_version too, and running one is an error.
  it("does not mistake an exported run bundle for a spec", () => {
    file("spec.toml", SPEC);
    file(
      "demo.mcmcrun.json",
      JSON.stringify({ kind: "mcmcjs-run-bundle", schema_version: "0", entry: {} }),
    );
    const found = scanModels(dir).map((path) => path.slice(dir.length + 1));
    expect(found).toEqual(["spec.toml"]);
  });

  it("keeps a file that only adapts a model defined elsewhere", () => {
    file("adapter.jl", 'include("other.jl")\nbuild_model(data) = other(data.y)\n');
    expect(scanModels(dir)).toHaveLength(1);
  });

  it("descends into subdirectories but skips the store and hidden or vendored dirs", () => {
    file("top.jl", MODEL);
    file("nested/deep/inner.jl", MODEL);
    file(".mcmc/runs/abc/model.jl", MODEL);
    file("node_modules/pkg/model.jl", MODEL);
    file(".hidden/model.jl", MODEL);
    const found = scanModels(dir).map((path) => path.slice(dir.length + 1));
    expect(found.sort()).toEqual(["nested/deep/inner.jl", "top.jl"]);
  });

  it("honors the depth limit", () => {
    file("a/b/c/d/buried.jl", MODEL);
    expect(scanModels(dir, 2)).toEqual([]);
    expect(scanModels(dir, 4)).toHaveLength(1);
  });

  it("returns nothing for a directory it cannot read", () => {
    expect(scanModels(join(dir, "does-not-exist"))).toEqual([]);
  });
});

function entry(over: Partial<LedgerEntry> = {}): LedgerEntry {
  return {
    id: "20260813-100000-abcdef",
    run_key: "key",
    spec_hash: "hash",
    status: "ok",
    model_path: "model.jl",
    data_sha256: "data",
    seed: 1,
    backend: { id: "turing", version: "1.12.6" },
    sampler: { algorithm: "NUTS", draws: 100, warmup: 100, chains: 2, adapt_delta: 0.8 },
    started_at: "2026-08-13T10:00:00Z",
    elapsed_ms: 1000,
    ...over,
  };
}

const at = (iso: string, over: Partial<LedgerEntry> = {}) => entry({ started_at: iso, ...over });

describe("runItems", () => {
  it("numbers runs newest first, matching the refs the other commands take", () => {
    const items = runItems([
      {
        storeDir: "/p/.mcmc",
        entries: [
          at("2026-08-01T00:00:00Z", { id: "oldest" }),
          at("2026-08-02T00:00:00Z", { id: "middle" }),
          at("2026-08-03T00:00:00Z", { id: "newest" }),
        ],
      },
    ]);
    expect(items.map((item) => [item.ref, item.entry.id])).toEqual([
      ["@1", "newest"],
      ["@2", "middle"],
      ["@3", "oldest"],
    ]);
  });

  // A run's store sits beside its model, so one project can hold several.
  it("merges several stores by time, remembering where each run lives", () => {
    const items = runItems([
      { storeDir: "/p/a/.mcmc", entries: [at("2026-08-01T00:00:00Z", { id: "a1" })] },
      { storeDir: "/p/b/.mcmc", entries: [at("2026-08-05T00:00:00Z", { id: "b1" })] },
    ]);
    expect(items.map((item) => [item.ref, item.entry.id, item.storeDir])).toEqual([
      ["@1", "b1", "/p/b/.mcmc"],
      ["@2", "a1", "/p/a/.mcmc"],
    ]);
  });

  it("leaves the ledger untouched", () => {
    const ledger = [entry({ id: "a" }), entry({ id: "b" })];
    runItems([{ storeDir: "/p/.mcmc", entries: ledger }]);
    expect(ledger.map((e) => e.id)).toEqual(["a", "b"]);
  });
});

describe("findStores", () => {
  it("finds a store beside a model in a subdirectory, not just above", () => {
    mkdirSync(join(dir, "examples", "coin", ".mcmc"), { recursive: true });
    mkdirSync(join(dir, "node_modules", "pkg", ".mcmc"), { recursive: true });
    expect(findStores(dir)).toEqual([join(dir, "examples", "coin", ".mcmc")]);
  });

  it("returns nothing when the project has no runs at all", () => {
    expect(findStores(dir)).toEqual([]);
  });
});

describe("modelItems", () => {
  it("labels models relative to the project root and counts their runs", () => {
    file("model.jl", MODEL);
    file("sub/other.jl", MODEL);
    const runs = runItems([
      {
        storeDir: join(dir, ".mcmc"),
        entries: [
          entry({ model_path: "model.jl" }),
          entry({ model_path: "model.jl" }),
          entry({ model_path: "sub/other.jl" }),
        ],
      },
    ]);
    const items = modelItems(dir, [join(dir, "model.jl"), join(dir, "sub", "other.jl")], runs);
    expect(items.map((item) => [item.label, item.language, item.runs])).toEqual([
      ["model.jl", "julia", 2],
      ["sub/other.jl", "julia", 1],
    ]);
  });

  // The bug this pins: `mcmc run` puts the store beside the model, so a run
  // recorded under examples/ has a model_path relative to that store.
  it("counts runs recorded in a store nested beside the model", () => {
    file("examples/coin/coin.jl", MODEL);
    const runs = runItems([
      {
        storeDir: join(dir, "examples", "coin", ".mcmc"),
        entries: [entry({ model_path: "coin.jl" })],
      },
    ]);
    const items = modelItems(dir, [join(dir, "examples", "coin", "coin.jl")], runs);
    expect(items.map((item) => [item.label, item.runs])).toEqual([["examples/coin/coin.jl", 1]]);
  });

  it("marks a model that has no entry function as not ready to run", () => {
    file("bare.jl", MODEL);
    file("ready.jl", `${MODEL}build_model(data) = m(data.y)\n`);
    file("spec.toml", SPEC);
    const items = modelItems(
      dir,
      [join(dir, "bare.jl"), join(dir, "ready.jl"), join(dir, "spec.toml")],
      [],
    );
    expect(items.map((item) => [item.label, item.ready])).toEqual([
      ["bare.jl", false],
      ["ready.jl", true],
      ["spec.toml", true],
    ]);
  });
});
