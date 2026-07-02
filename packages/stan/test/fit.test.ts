import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseSamples, type ResolvedSpec } from "@mcmcjs/core";
import type { DrawBatch, FitProgress } from "@mcmcjs/engine";
import { describe, expect, it } from "vitest";
import type { CmdStanInstall } from "../src/environment";
import { chainArgs, runFit } from "../src/fit";
import type { StanSpawn } from "../src/runner";

const CSV_HEADER =
  "lp__,accept_stat__,stepsize__,treedepth__,n_leapfrog__,divergent__,energy__,theta";

function makeSpec(dir: string, chains = 2): ResolvedSpec {
  const modelPath = join(dir, "model.stan");
  writeFileSync(modelPath, "parameters { real theta; } model { theta ~ normal(0, 1); }\n");
  return {
    schema_version: "0",
    backend: { id: "stan", runtime: "cmdstan", version: "installed" },
    model: { kind: "file", path: "./model.stan", entry: "build_model" },
    sampler: { algorithm: "NUTS", draws: 4, warmup: 2, chains, adapt_delta: 0.8 },
    data: { N: 3 },
    output: { format: "mcmcchains-json" },
    seed: 42,
    specPath: join(dir, "spec.toml"),
    modelPath,
    specHash: "testhash",
  } as ResolvedSpec;
}

function fakeInstall(dir: string): CmdStanInstall {
  return { version: "2.39.0", home: join(dir, "cmdstan-2.39.0") };
}

/** A spawn that emits progress and writes a plausible per-chain CSV. */
function fakeCmdStan(opts?: { failChain?: number }): StanSpawn {
  return async (_command, args, spawnOpts) => {
    const id = Number(args.find((a) => a.startsWith("id="))?.slice(3));
    const csv = args.find((a) => a.startsWith("file=") && a.endsWith(".csv"))?.slice(5);
    if (opts?.failChain === id) {
      return { code: 1, stderr: "Exception: something went wrong\n" };
    }
    spawnOpts?.onStdoutLine?.("Iteration: 2 / 6 [ 33%]  (Warmup)");
    spawnOpts?.onStdoutLine?.("Iteration: 6 / 6 [100%]  (Sampling)");
    if (csv) {
      const rows = Array.from({ length: 4 }, (_, r) =>
        [-(r + 1), 0.9, 0.7, 3, 7, 0, r + 2, id * 10 + r].join(","),
      );
      writeFileSync(
        csv,
        `# model = m\n${CSV_HEADER}\n# Adaptation terminated\n${rows.join("\n")}\n`,
      );
    }
    return { code: 0, stderr: "" };
  };
}

describe("chainArgs", () => {
  it("maps the sampler onto the CmdStan CLI with a shared seed and per-chain id", () => {
    const dir = mkdtempSync(join(tmpdir(), "stan-fit-"));
    const spec = makeSpec(dir);
    const args = chainArgs(spec, 2, "/tmp/data.json", "/tmp/chain_2.csv");
    expect(args).toEqual([
      "sample",
      "num_samples=4",
      "num_warmup=2",
      "adapt",
      "delta=0.8",
      "data",
      "file=/tmp/data.json",
      "random",
      "seed=42",
      "id=2",
      "output",
      "file=/tmp/chain_2.csv",
      "refresh=1",
    ]);
  });
});

describe("runFit", () => {
  function compiled(dir: string) {
    // A pre-populated compile cache so runFit never invokes make.
    const cacheRoot = join(dir, "cache");
    const spec = makeSpec(dir);
    const runner = async () => {
      throw new Error("make must not run: the binary is pre-cached");
    };
    return { spec, compile: { cacheRoot, runner } };
  }

  async function seedCache(spec: ResolvedSpec, cacheRoot: string) {
    const { modelCacheDir } = await import("../src/compile");
    const source = readFileSync(spec.modelPath, "utf8");
    const cacheDir = modelCacheDir(source, "2.39.0", cacheRoot);
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(join(cacheDir, "model"), "#!/bin/sh\n");
    writeFileSync(join(cacheDir, ".ok"), "");
    return cacheDir;
  }

  it("runs all chains, streams progress and draws, writes samples and a run record", async () => {
    const dir = mkdtempSync(join(tmpdir(), "stan-fit-"));
    const { spec, compile } = compiled(dir);
    await seedCache(spec, compile.cacheRoot);

    const progress: FitProgress[] = [];
    const batches: DrawBatch[] = [];
    const outPath = join(dir, "samples.json");
    const result = await runFit(spec, fakeInstall(dir), {
      spawn: fakeCmdStan(),
      outPath,
      onProgress: (p) => progress.push(p),
      onDraws: (b) => batches.push(b),
      compile,
    });

    expect(result.status).toBe("ok");
    expect(result.runtimeActual).toBe("2.39.0");
    expect(result.samplesFile).toBe(outPath);

    const samples = parseSamples(readFileSync(outPath, "utf8"));
    expect(samples.nChains).toBe(2);
    expect(samples.nDraws).toBe(4);
    expect(samples.variables).toContain("theta");
    expect(Array.from(samples.draws.get("theta") ?? [])).toEqual([10, 11, 12, 13, 20, 21, 22, 23]);

    expect(progress.filter((p) => p.done)).toHaveLength(2);
    expect(progress.some((p) => p.chain === 2)).toBe(true);

    const chain0 = batches.filter((b) => b.chain === 0);
    expect(chain0.length).toBeGreaterThan(0);
    expect(chain0.flatMap((b) => b.draws.theta ?? [])).toEqual([10, 11, 12, 13]);

    const record = JSON.parse(readFileSync(`${outPath}.run.json`, "utf8"));
    expect(record.backend).toEqual({ id: "stan", runtime: "cmdstan" });
    expect(record.runtime.actual).toBe("2.39.0");
    expect(record.samples_file).toBe(outPath);
  });

  it("reports a failing chain as a sample-stage error", async () => {
    const dir = mkdtempSync(join(tmpdir(), "stan-fit-"));
    const { spec, compile } = compiled(dir);
    await seedCache(spec, compile.cacheRoot);

    const result = await runFit(spec, fakeInstall(dir), {
      spawn: fakeCmdStan({ failChain: 2 }),
      outPath: join(dir, "samples.json"),
      compile,
    });
    expect(result.status).toBe("error");
    expect(result.stage).toBe("sample");
    expect(result.error).toContain("chain 2");
    expect(result.error).toContain("something went wrong");
  });

  it("returns cancelled when the signal aborts before spawning", async () => {
    const dir = mkdtempSync(join(tmpdir(), "stan-fit-"));
    const { spec, compile } = compiled(dir);
    await seedCache(spec, compile.cacheRoot);
    const controller = new AbortController();
    controller.abort();
    const result = await runFit(spec, fakeInstall(dir), {
      spawn: fakeCmdStan(),
      outPath: join(dir, "samples.json"),
      signal: controller.signal,
      compile,
    });
    expect(result.status).toBe("cancelled");
  });

  it("surfaces a compile failure with the compile stage", async () => {
    const dir = mkdtempSync(join(tmpdir(), "stan-fit-"));
    const spec = makeSpec(dir);
    const result = await runFit(spec, fakeInstall(dir), {
      spawn: fakeCmdStan(),
      outPath: join(dir, "samples.json"),
      compile: {
        cacheRoot: join(dir, "cache"),
        runner: async () => {
          throw new Error("stanc: syntax error in model");
        },
      },
    });
    expect(result.status).toBe("error");
    expect(result.stage).toBe("compile");
    expect(result.error).toContain("syntax error");
  });
});
