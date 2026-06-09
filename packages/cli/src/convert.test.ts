import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseSpec } from "@mcmcjs/core";
import { describe, expect, it } from "vitest";
import { buildSpec, convertGraph, juliaBugsModelFile } from "./convert";

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
      param2: "0.0001",
    },
    {
      id: "plate_i",
      name: "Plate i",
      type: "node",
      nodeType: "plate",
      loopVariable: "i",
      loopRange: "1:N",
    },
    {
      id: "y",
      name: "y",
      type: "node",
      nodeType: "observed",
      parent: "plate_i",
      indices: "i",
      distribution: "dnorm",
      param1: "mu",
      param2: "1",
      observed: true,
    },
    { id: "e_mu_y", type: "edge", source: "mu", target: "y" },
  ],
  dataContent: JSON.stringify({ data: { N: 3, y: [1.0, 0.8, 1.2] }, inits: {} }),
  version: 1,
});

describe("juliaBugsModelFile", () => {
  it("wraps model code in the idiomatic string-form @bugs plus a build_model adapter", () => {
    const file = juliaBugsModelFile("model {\n  mu ~ dnorm(0, 1)\n}");
    expect(file).toContain('JuliaBUGS.@bugs("""');
    expect(file).toContain("model {");
    expect(file).toContain(
      "build_model(data) = JuliaBUGS.compile(model_def, data; adtype = JuliaBUGS.ADTypes.AutoForwardDiff())",
    );
  });
});

describe("buildSpec", () => {
  it("produces a juliabugs spec referencing the model file with the given seed and data", () => {
    const spec = buildSpec("demo.jl", { N: 3 }, 42);
    expect(spec).toMatchObject({
      schema_version: "0",
      seed: 42,
      backend: { id: "juliabugs" },
      model: { kind: "file", path: "./demo.jl", entry: "build_model" },
      data: { N: 3 },
    });
  });
});

describe("convertGraph", () => {
  const write = (text: string): string => {
    const dir = mkdtempSync(join(tmpdir(), "mcmcjs-convert-"));
    const path = join(dir, "demo.json");
    writeFileSync(path, text);
    return path;
  };

  it("writes a model file and a spec that parses back as a valid juliabugs spec", () => {
    const graphPath = write(GRAPH);
    const result = convertGraph(graphPath, undefined, 7);

    const jl = readFileSync(result.modelPath, "utf8");
    expect(jl).toContain("y[i] ~ dnorm(mu, 1)");
    expect(jl).toContain("for (i in 1:N) {");

    const spec = parseSpec(result.specPath);
    expect(spec.backend.id).toBe("juliabugs");
    expect(spec.seed).toBe(7);
    expect(spec.data).toEqual({ N: 3, y: [1.0, 0.8, 1.2] });
    expect(spec.model.entry).toBe("build_model");
  });

  it("rejects a graph with a cycle", () => {
    const cyclic = JSON.stringify({
      name: "cyclic",
      elements: [
        { id: "a", name: "a", type: "node", nodeType: "deterministic", equation: "b" },
        { id: "b", name: "b", type: "node", nodeType: "deterministic", equation: "a" },
        { id: "e1", type: "edge", source: "a", target: "b" },
        { id: "e2", type: "edge", source: "b", target: "a" },
      ],
    });
    expect(() => convertGraph(write(cyclic), undefined, 1)).toThrow(/cycle/);
  });
});
