import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseSpec, serializeSpecToml } from "@mcmcjs/core";
import { describe, expect, it } from "vitest";
import { detectBackend, resolveToSpec, scaffoldSpec } from "../src/run";

const tmp = (): string => mkdtempSync(join(tmpdir(), "mcmcjs-run-"));

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

describe("scaffoldSpec", () => {
  it("produces a spec that parseSpec accepts after TOML round-trip", () => {
    const spec = scaffoldSpec({
      modelFileName: "model.jl",
      backend: "turing",
      data: { J: 8, y: [28, 8, -3], sigma: [15, 10, 16] },
      seed: 42,
      draws: 500,
      warmup: 250,
      chains: 2,
    });
    const dir = tmp();
    writeFileSync(join(dir, "model.jl"), "using Turing");
    const specPath = join(dir, "model.toml");
    writeFileSync(specPath, serializeSpecToml(spec));

    const parsed = parseSpec(specPath);
    expect(parsed.backend.id).toBe("turing");
    expect(parsed.seed).toBe(42);
    expect(parsed.sampler).toMatchObject({ draws: 500, warmup: 250, chains: 2 });
    expect(parsed.model.entry).toBe("build_model");
    expect(parsed.data).toEqual({ J: 8, y: [28, 8, -3], sigma: [15, 10, 16] });
    expect(parsed.modelPath).toBe(join(dir, "model.jl"));
  });

  it("writes a custom entry only when given", () => {
    const base = {
      modelFileName: "m.jl",
      backend: "juliabugs" as const,
      data: {},
      seed: 1,
      draws: 100,
      warmup: 100,
      chains: 1,
    };
    const withEntry = scaffoldSpec({ ...base, entry: "make_model" });
    expect((withEntry.model as Record<string, unknown>).entry).toBe("make_model");
    expect("entry" in (scaffoldSpec(base).model as Record<string, unknown>)).toBe(false);
  });
});

describe("resolveToSpec", () => {
  it("scaffolds a sibling spec for a model file and reuses it next time", () => {
    const dir = tmp();
    const modelPath = join(dir, "model.jl");
    writeFileSync(modelPath, "using Turing\n@model function f() end");

    const first = resolveToSpec(modelPath, { seed: 7, draws: 200 });
    expect(first.specPath).toBe(join(dir, "model.toml"));
    expect(parseSpec(first.specPath).seed).toBe(7);
    expect(parseSpec(first.specPath).sampler.draws).toBe(200);

    const second = resolveToSpec(modelPath, {});
    expect(second.specPath).toBe(first.specPath);
    expect(second.notes.join("\n")).toContain("using existing spec");
  });

  it("rejects scaffold flags once the sibling spec exists, including sampler flags", () => {
    const dir = tmp();
    const modelPath = join(dir, "model.jl");
    writeFileSync(modelPath, "using Turing\n@model function f() end");
    resolveToSpec(modelPath, { seed: 1 });

    expect(() => resolveToSpec(modelPath, { seed: 2 })).toThrow(/only applies when scaffolding/);
    expect(() => resolveToSpec(modelPath, { draws: 200 })).toThrow(/only applies when scaffolding/);
  });

  it("rejects scaffold flags for a spec input", () => {
    const dir = tmp();
    writeFileSync(join(dir, "m.jl"), "using Turing");
    const specPath = join(dir, "spec.toml");
    writeFileSync(
      specPath,
      serializeSpecToml(
        scaffoldSpec({
          modelFileName: "m.jl",
          backend: "turing",
          data: {},
          seed: 1,
          draws: 10,
          warmup: 10,
          chains: 1,
        }),
      ),
    );
    expect(resolveToSpec(specPath, {}).specPath).toBe(specPath);
    expect(() => resolveToSpec(specPath, { chains: 8 })).toThrow(/already a spec/);
  });

  it("converts a graph once, honoring sampler flags, then reuses the spec", () => {
    const dir = tmp();
    const graphPath = join(dir, "demo.json");
    writeFileSync(graphPath, GRAPH);

    const first = resolveToSpec(graphPath, { seed: 5, draws: 250 });
    expect(first.specPath).toBe(join(dir, "demo.toml"));
    const parsed = parseSpec(first.specPath);
    expect(parsed.seed).toBe(5);
    expect(parsed.sampler.draws).toBe(250);
    expect(existsSync(join(dir, "demo.jl"))).toBe(true);

    const before = readFileSync(first.specPath, "utf8");
    const second = resolveToSpec(graphPath, {});
    expect(second.notes.join("\n")).toContain("using existing spec");
    expect(readFileSync(first.specPath, "utf8")).toBe(before);
    expect(() => resolveToSpec(graphPath, { seed: 9 })).toThrow(/only applies when scaffolding/);
  });

  it("rejects flags that cannot apply to a graph", () => {
    const dir = tmp();
    const graphPath = join(dir, "demo.json");
    writeFileSync(graphPath, GRAPH);
    expect(() => resolveToSpec(graphPath, { backend: "turing" })).toThrow(
      /does not apply to a graph/,
    );
  });

  it("fails fast with a clear error instead of writing an invalid spec", () => {
    const dir = tmp();
    const modelPath = join(dir, "model.jl");
    writeFileSync(modelPath, "using Turing");
    expect(() => resolveToSpec(modelPath, { draws: -5, seed: 1 })).toThrow(
      /cannot scaffold a valid spec/,
    );
    expect(existsSync(join(dir, "model.toml"))).toBe(false);
  });

  it("names the file when JSON input is malformed", () => {
    const dir = tmp();
    const path = join(dir, "broken.json");
    writeFileSync(path, "{not json");
    expect(() => resolveToSpec(path, {})).toThrow(/invalid JSON in .*broken\.json/);
  });
});
