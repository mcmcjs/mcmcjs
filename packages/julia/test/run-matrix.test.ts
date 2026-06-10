import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ResolvedSpec } from "@mcmcjs/core";
import type { FitRunner } from "@mcmcjs/engine";
import { describe, expect, it } from "vitest";
import { runMatrix } from "../src/run-matrix";

const SAMPLES = JSON.stringify({
  size: [1, 1, 1],
  value_flat: [0.5],
  parameters: ["mu"],
  name_map: { parameters: ["mu"], internals: [] },
});
const PROVENANCE = JSON.stringify({ julia_version: "1.12.6", packages: {}, manifest_sha256: "x" });

function spec(): ResolvedSpec {
  return {
    schema_version: "0",
    backend: { id: "turing", runtime: "julia", version: "release" },
    model: { kind: "file", path: "./m.jl", entry: "build_model" },
    sampler: { algorithm: "NUTS", draws: 1, warmup: 1, chains: 1, adapt_delta: 0.8 },
    data: {},
    output: { format: "mcmcchains-json" },
    seed: 1,
    specPath: "/x/m.toml",
    modelPath: "/x/m.jl",
    specHash: "h",
  };
}

const outDir = (): string => mkdtempSync(join(tmpdir(), "mcmcjs-matrix-"));
const resolveOk = async () => ({ command: "/bin/julia", args: [] });

// A spawn that writes the canned samples to the outPath named in the request.json.
const writingSpawn: FitRunner = async (_command, args) => {
  const request = JSON.parse(readFileSync(args.at(-1) as string, "utf8"));
  writeFileSync(request.out, SAMPLES);
  return { stdout: PROVENANCE, stderr: "", code: 0 };
};

describe("runMatrix", () => {
  it("runs every version and writes one samples file each", async () => {
    const dir = outDir();
    const result = await runMatrix(spec(), ["1.10", "release"], {
      spawn: writingSpawn,
      resolve: resolveOk,
      projectDir: "/proj",
      outDir: dir,
    });
    expect(result.ok).toBe(true);
    expect(result.entries.map((e) => e.version)).toEqual(["1.10", "release"]);
    expect(existsSync(join(dir, "1.10.samples.json"))).toBe(true);
    expect(existsSync(join(dir, "release.samples.json"))).toBe(true);
  });

  it("records a resolve failure and keeps going with keepGoing", async () => {
    const result = await runMatrix(spec(), ["1.9", "release"], {
      spawn: writingSpawn,
      resolve: async (v) => {
        if (v === "1.9") throw new Error("Julia version not installed; add 1.9");
        return { command: "/bin/julia", args: [] };
      },
      projectDir: "/proj",
      outDir: outDir(),
      keepGoing: true,
    });
    expect(result.ok).toBe(false);
    expect(result.entries[0]?.status).toBe("error");
    expect(result.entries[0]?.error).toMatch(/add 1\.9/);
    expect(result.entries[1]?.status).toBe("ok");
  });

  it("stops at the first failure without keepGoing", async () => {
    const result = await runMatrix(spec(), ["1.10", "release"], {
      spawn: async () => ({ stdout: "", stderr: "", code: 1 }),
      resolve: resolveOk,
      projectDir: "/proj",
      outDir: outDir(),
    });
    expect(result.entries).toHaveLength(1);
    expect(result.ok).toBe(false);
  });
});
