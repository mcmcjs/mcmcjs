import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LedgerEntry } from "@mcmcjs/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { modelItems, runItems, scanModels } from "../../src/browse";

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

describe("scanModels", () => {
  it("finds model files and specs, and nothing else", () => {
    file("model.jl", MODEL);
    file("model.stan", "parameters { real mu; }\nmodel { mu ~ normal(0,1); }");
    file("spec.toml", 'schema_version = "0"');
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

describe("runItems", () => {
  it("numbers runs newest first, matching the refs the other commands take", () => {
    const items = runItems([
      entry({ id: "oldest" }),
      entry({ id: "middle" }),
      entry({ id: "newest" }),
    ]);
    expect(items.map((item) => [item.ref, item.entry.id])).toEqual([
      ["@1", "newest"],
      ["@2", "middle"],
      ["@3", "oldest"],
    ]);
  });

  it("leaves the ledger untouched", () => {
    const ledger = [entry({ id: "a" }), entry({ id: "b" })];
    runItems(ledger);
    expect(ledger.map((e) => e.id)).toEqual(["a", "b"]);
  });
});

describe("modelItems", () => {
  it("labels models relative to the project root and counts their runs", () => {
    file("model.jl", MODEL);
    file("sub/other.jl", MODEL);
    const runs = runItems([
      entry({ model_path: "model.jl" }),
      entry({ model_path: "model.jl" }),
      entry({ model_path: "sub/other.jl" }),
    ]);
    const items = modelItems(dir, [join(dir, "model.jl"), join(dir, "sub", "other.jl")], runs);
    expect(items.map((item) => [item.label, item.language, item.runs])).toEqual([
      ["model.jl", "julia", 2],
      ["sub/other.jl", "julia", 1],
    ]);
  });

  it("marks a model that has no entry function as not ready to run", () => {
    file("bare.jl", MODEL);
    file("ready.jl", `${MODEL}build_model(data) = m(data.y)\n`);
    file("spec.toml", 'schema_version = "0"');
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
