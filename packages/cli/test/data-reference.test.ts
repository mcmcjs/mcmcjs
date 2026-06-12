import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SpecSchema } from "@mcmcjs/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveData } from "../src/data-file";
import { buildRunConfig, frozenSpecFor } from "../src/run";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "mcmcjs-dataref-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("resolveData", () => {
  it("returns inline data unchanged when no file is given", () => {
    expect(resolveData({ x: [1, 2] })).toEqual({ data: { x: [1, 2] } });
  });

  it("loads a file and hashes its bytes", () => {
    const path = join(dir, "data.csv");
    writeFileSync(path, "y\n1\n2\n3\n");
    const r = resolveData({}, path);
    expect(r.dataFile).toBe(path);
    expect(r.data).toMatchObject({ y: [1, 2, 3], N: 3 });
    expect(r.dataSha256).toBe(createHash("sha256").update(readFileSync(path)).digest("hex"));
  });
});

describe("frozenSpecFor with a data file", () => {
  const base = SpecSchema.parse({
    schema_version: "0",
    seed: 1,
    backend: { id: "turing" },
    model: { kind: "file", path: "./m.jl" },
    sampler: { algorithm: "NUTS", draws: 10 },
    data: { x: [1, 2, 3] },
  });

  it("references the data file and drops inline data", () => {
    const frozen = frozenSpecFor(base, "1.11", "m.jl", "/abs/data.csv");
    expect(frozen.data_file).toBe("/abs/data.csv");
    expect(frozen.data).toEqual({});
    // The frozen spec must still validate (data and data_file are exclusive).
    expect(() => SpecSchema.parse(frozen)).not.toThrow();
  });

  it("keeps inline data when there is no file", () => {
    const frozen = frozenSpecFor(base, "1.11", "m.jl");
    expect(frozen.data).toEqual({ x: [1, 2, 3] });
    expect(frozen.data_file).toBeUndefined();
  });
});

describe("SpecSchema data_file", () => {
  it("rejects inline data and data_file together", () => {
    expect(() =>
      SpecSchema.parse({
        schema_version: "0",
        seed: 1,
        backend: { id: "turing" },
        model: { kind: "file", path: "./m.jl" },
        sampler: { algorithm: "NUTS", draws: 10 },
        data: { x: [1] },
        data_file: "./data.csv",
      }),
    ).toThrow(/not both/);
  });
});

describe("buildRunConfig with a spec data_file", () => {
  it("references the spec's data_file resolved against the spec dir", () => {
    writeFileSync(join(dir, "m.jl"), "using Turing\n@model f() = nothing\nbuild_model(d) = f()\n");
    const specPath = join(dir, "m.toml");
    writeFileSync(
      specPath,
      [
        'schema_version = "0"',
        "seed = 1",
        'data_file = "./data.csv"',
        "[backend]",
        'id = "turing"',
        "[model]",
        'kind = "file"',
        'path = "./m.jl"',
        "[sampler]",
        'algorithm = "NUTS"',
        "draws = 10",
      ].join("\n"),
    );
    const config = buildRunConfig(specPath, {});
    expect(config.dataFile).toBe(join(dir, "data.csv"));
  });
});
