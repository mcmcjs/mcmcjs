import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadDataFile, parseSpec } from "@mcmcjs/core";
import { describe, expect, it } from "vitest";
import {
  buildSpec,
  buildStanSpec,
  convertGraph,
  juliaBugsModelFile,
  underscoreDottedNames,
} from "../src/convert";

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

describe("underscoreDottedNames", () => {
  it("renames a dotted data key the way the generated @bugs call renames it", () => {
    expect(underscoreDottedNames({ M: 4, "t.cen": [1, 2] })).toEqual({ M: 4, t_cen: [1, 2] });
  });

  it("refuses a rename that would shadow another variable", () => {
    expect(() => underscoreDottedNames({ "t.cen": [1], t_cen: [2] })).toThrow(/becomes t_cen/);
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

  it("sends data with an unobserved entry to a JSON sidecar the spec references", () => {
    const graph = JSON.parse(GRAPH) as { dataContent: string };
    graph.dataContent = JSON.stringify({ data: { N: 3, y: [1.0, null, 1.2] }, inits: {} });
    const result = convertGraph(write(JSON.stringify(graph)), undefined, 7);

    expect(result.dataPath?.endsWith("demo.data.json")).toBe(true);
    expect(JSON.parse(readFileSync(result.dataPath as string, "utf8"))).toEqual({
      N: 3,
      y: [1.0, null, 1.2],
    });

    // The spec is still TOML, and points at the data the way `--data` would.
    const spec = parseSpec(result.specPath);
    expect(spec.specPath.endsWith(".toml")).toBe(true);
    expect(spec.data).toEqual({});
    expect(spec.dataFilePath).toBe(result.dataPath);
    expect(loadDataFile(spec.dataFilePath as string)).toEqual({ N: 3, y: [1.0, null, 1.2] });
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

describe("convertGraph with the stan target", () => {
  it("writes a Stan program and a parseable stan-backend spec", () => {
    const dir = mkdtempSync(join(tmpdir(), "mcmcjs-convert-stan-"));
    const graphPath = join(dir, "demo.json");
    writeFileSync(graphPath, GRAPH);

    const result = convertGraph(graphPath, undefined, 7, undefined, "stan");
    expect(result.modelPath.endsWith("demo.stan")).toBe(true);

    const model = readFileSync(result.modelPath, "utf8");
    expect(model).toContain("data {");
    expect(model).toContain("model {");
    expect(model).not.toContain("@bugs");

    const spec = parseSpec(result.specPath);
    expect(spec.backend.id).toBe("stan");
    expect(spec.model.path).toBe("./demo.stan");
    expect(spec.seed).toBe(7);
    expect(spec.data).toMatchObject({ N: 3, y: [1.0, 0.8, 1.2] });
  });

  it("buildStanSpec validates against the spec schema", () => {
    const dir = mkdtempSync(join(tmpdir(), "mcmcjs-convert-stan-"));
    const specPath = join(dir, "demo.json");
    writeFileSync(specPath, JSON.stringify(buildStanSpec("demo.stan", { N: 3 }, 42)));
    const parsed = parseSpec(specPath);
    expect(parsed.backend.id).toBe("stan");
    expect(parsed.backend.runtime).toBe("cmdstan");
    expect(parsed.sampler.algorithm).toBe("NUTS");
  });
});

describe("juliaBugsModelFile marginalization", () => {
  it("keeps the plain compile when there are no discrete latents", () => {
    const file = juliaBugsModelFile("model {\n  mu ~ dnorm(0, 1)\n}");
    expect(file).toContain(
      "build_model(data) = JuliaBUGS.compile(model_def, data; adtype = JuliaBUGS.ADTypes.AutoForwardDiff())",
    );
    expect(file).not.toContain("UseAutoMarginalization");
  });

  it("enables auto-marginalization behind invokelatest when asked", () => {
    const file = juliaBugsModelFile("model {\n  z ~ dcat(w[1:2])\n}", true);
    expect(file).toContain("JuliaBUGS.settrans(model, true)");
    expect(file).toContain(
      "JuliaBUGS.set_evaluation_mode, model, JuliaBUGS.UseAutoMarginalization()",
    );
    expect(file).toContain("Base.invokelatest(JuliaBUGS.BUGSModelWithGradient, model");
    // The mode switch and the wrapper both call node functions defined during compile.
    expect(file.match(/Base\.invokelatest/g)).toHaveLength(2);
    expect(file).not.toContain("compile(model_def, data; adtype");
  });
});

describe("convertGraph juliabugs target", () => {
  const graphWithLatent = JSON.stringify({
    name: "Mix",
    elements: [
      { id: "w", name: "w", type: "node", nodeType: "constant" },
      {
        id: "plate_i",
        name: "Plate i",
        type: "node",
        nodeType: "plate",
        loopVariable: "i",
        loopRange: "1:N",
      },
      {
        id: "z",
        name: "z",
        type: "node",
        nodeType: "stochastic",
        parent: "plate_i",
        indices: "i",
        distribution: "dcat",
        param1: "w[1:2]",
      },
      {
        id: "y",
        name: "y",
        type: "node",
        nodeType: "observed",
        parent: "plate_i",
        indices: "i",
        distribution: "dnorm",
        param1: "mu[z[i]]",
        param2: "1",
        observed: true,
      },
      { id: "e", type: "edge", source: "z", target: "y" },
    ],
    dataContent: JSON.stringify({ data: { N: 2, y: [1, 2], w: [0.5, 0.5] }, inits: {} }),
    version: 1,
  });

  it("marginalizes a graph that has a discrete latent", () => {
    const dir = mkdtempSync(join(tmpdir(), "mcmcjs-convert-jb-"));
    const graphPath = join(dir, "mix.json");
    writeFileSync(graphPath, graphWithLatent);
    const result = convertGraph(graphPath, undefined, 1);
    const model = readFileSync(result.modelPath, "utf8");
    expect(model).toContain("UseAutoMarginalization");
    expect(parseSpec(result.specPath).backend.id).toBe("juliabugs");
  });

  it("leaves a continuous-only graph on the plain compile path", () => {
    const dir = mkdtempSync(join(tmpdir(), "mcmcjs-convert-jb-"));
    const graphPath = join(dir, "demo.json");
    writeFileSync(graphPath, GRAPH);
    const result = convertGraph(graphPath, undefined, 1);
    expect(readFileSync(result.modelPath, "utf8")).not.toContain("UseAutoMarginalization");
  });
});
