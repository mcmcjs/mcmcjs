import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { hashSpec } from "../../src/spec/normalize";
import { parseSpec } from "../../src/spec/parse";
import { DEFAULT_CMDSTAN_CHANNEL, DEFAULT_JULIA_CHANNEL, SpecSchema } from "../../src/spec/schema";

const VALID = {
  schema_version: "0",
  backend: { id: "turing" },
  model: { kind: "file", path: "./model.jl" },
  sampler: { draws: 1000 },
  seed: 42,
  data: { J: 8 },
};

describe("SpecSchema", () => {
  it("applies defaults for runtime, version, sampler, and output", () => {
    const spec = SpecSchema.parse(VALID);
    expect(spec.backend.runtime).toBe("julia");
    expect(spec.backend.version).toBe(DEFAULT_JULIA_CHANNEL);
    expect(spec.sampler.algorithm).toBe("NUTS");
    expect(spec.sampler.warmup).toBe(1000);
    expect(spec.sampler.chains).toBe(4);
    expect(spec.model.entry).toBe("build_model");
    expect(spec.output.format).toBe("mcmcchains-json");
  });

  it("rejects an unknown sampler key", () => {
    expect(() =>
      SpecSchema.parse({ ...VALID, sampler: { draws: 10, nuts_max_depth: 9 } }),
    ).toThrow();
  });

  it("requires a seed", () => {
    const { seed, ...noSeed } = VALID;
    expect(() => SpecSchema.parse(noSeed)).toThrow();
  });

  it("rejects a seed beyond the safe integer range", () => {
    expect(() => SpecSchema.parse({ ...VALID, seed: Number.MAX_SAFE_INTEGER + 2 })).toThrow();
  });

  it("accepts a juliabugs backend and rejects an unknown one", () => {
    expect(SpecSchema.parse({ ...VALID, backend: { id: "juliabugs" } }).backend.id).toBe(
      "juliabugs",
    );
    expect(() => SpecSchema.parse({ ...VALID, backend: { id: "nimble" } })).toThrow();
  });

  it("derives the runtime and default channel per backend", () => {
    const julia = SpecSchema.parse({ ...VALID, backend: { id: "turing" } }).backend;
    expect(julia.runtime).toBe("julia");
    expect(julia.version).toBe(DEFAULT_JULIA_CHANNEL);

    const stan = SpecSchema.parse({ ...VALID, backend: { id: "stan" } }).backend;
    expect(stan.runtime).toBe("cmdstan");
    expect(stan.version).toBe(DEFAULT_CMDSTAN_CHANNEL);
  });

  it("rejects a backend on the wrong runtime and julia-only package pins on stan", () => {
    expect(() => SpecSchema.parse({ ...VALID, backend: { id: "stan", runtime: "julia" } })).toThrow(
      /runs on the .{1,2}cmdstan.{1,2} runtime/,
    );
    expect(() =>
      SpecSchema.parse({ ...VALID, backend: { id: "turing", runtime: "cmdstan" } }),
    ).toThrow(/runs on the .{1,2}julia.{1,2} runtime/);
    expect(() =>
      SpecSchema.parse({ ...VALID, backend: { id: "stan", packages: { Turing: "0.45" } } }),
    ).toThrow(/julia runtime only/);
  });

  it("leaves predict undefined when absent", () => {
    expect(SpecSchema.parse(VALID).predict).toBeUndefined();
  });

  it("parses a predict block with targets", () => {
    expect(SpecSchema.parse({ ...VALID, predict: { targets: ["y"] } }).predict?.targets).toEqual([
      "y",
    ]);
  });

  it("requires at least one predict target and rejects unknown predict keys", () => {
    expect(() => SpecSchema.parse({ ...VALID, predict: { targets: [] } })).toThrow();
    expect(() => SpecSchema.parse({ ...VALID, predict: { targets: ["y"], bogus: 1 } })).toThrow();
  });
});

describe("hashSpec", () => {
  it("is stable regardless of key order", () => {
    const a = SpecSchema.parse(VALID);
    const b = SpecSchema.parse({
      data: { J: 8 },
      seed: 42,
      sampler: { draws: 1000 },
      model: { path: "./model.jl", kind: "file" },
      backend: { id: "turing" },
      schema_version: "0",
    });
    expect(hashSpec(a)).toBe(hashSpec(b));
  });

  it("changes when a field changes", () => {
    const a = SpecSchema.parse(VALID);
    const b = SpecSchema.parse({ ...VALID, seed: 43 });
    expect(hashSpec(a)).not.toBe(hashSpec(b));
  });
});

describe("parseSpec", () => {
  const write = (name: string, text: string): string => {
    const dir = mkdtempSync(join(tmpdir(), "mcmcjs-spec-"));
    const path = join(dir, name);
    writeFileSync(path, text);
    return path;
  };

  it("parses TOML and resolves the model path against the spec directory", () => {
    const path = write(
      "m.toml",
      [
        'schema_version = "0"',
        "seed = 42",
        "[backend]",
        'id = "turing"',
        "[sampler]",
        "draws = 500",
        "[model]",
        'kind = "file"',
        'path = "./model.jl"',
      ].join("\n"),
    );
    const spec = parseSpec(path);
    expect(spec.sampler.draws).toBe(500);
    expect(spec.modelPath.endsWith("/model.jl")).toBe(true);
    expect(spec.modelPath.startsWith("/")).toBe(true);
  });

  it("parses TOML and JSON to the same spec hash", () => {
    const toml = parseSpec(
      write(
        "m.toml",
        [
          'schema_version = "0"',
          "seed = 7",
          "[backend]",
          'id = "turing"',
          "[sampler]",
          "draws = 100",
          "[model]",
          'kind = "file"',
          'path = "./m.jl"',
        ].join("\n"),
      ),
    );
    const json = parseSpec(
      write(
        "m.json",
        JSON.stringify({
          schema_version: "0",
          seed: 7,
          backend: { id: "turing" },
          sampler: { draws: 100 },
          model: { kind: "file", path: "./m.jl" },
        }),
      ),
    );
    expect(toml.specHash).toBe(json.specHash);
  });

  it("throws a readable error for an invalid spec", () => {
    const path = write(
      "bad.json",
      JSON.stringify({
        schema_version: "0",
        backend: { id: "turing" },
        model: { kind: "file", path: "./m.jl" },
        sampler: {},
      }),
    );
    expect(() => parseSpec(path)).toThrow(/invalid spec/);
  });
});
