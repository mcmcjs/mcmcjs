import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  chainView,
  DEFAULT_JULIA_CHANNEL,
  parseSamples,
  type ResolvedSpec,
  type Samples,
} from "@mcmcjs/core";
import { createFitRunner, createRunner, type DrawBatch } from "@mcmcjs/engine";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { detectJuliaup } from "../src/environment";
import { runFit } from "../src/fit";
import { runPredict } from "../src/predict";
import { managedProjectDir, managedProjectReady } from "../src/project";
import { resolveVersion } from "../src/versions";

/**
 * The seeded end-to-end reference: a real Julia fit that loads a model plus
 * Stan-style JSON data, streams draw batches, reconstructs the final samples
 * from them, and cancels a separate run mid-flight. It drives actual Julia, so
 * it is opt-in (MCMC_E2E=1) and skips unless the pinned env is already
 * provisioned. Run it with: MCMC_E2E=1 pnpm -F @mcmcjs/julia test e2e
 */
async function probe(): Promise<{ command: string; args: string[]; projectDir: string } | null> {
  if (process.env.MCMC_E2E !== "1") return null;
  try {
    const juliaup = await detectJuliaup();
    if (!juliaup.found || !juliaup.path) return null;
    const resolved = await resolveVersion(juliaup.path, DEFAULT_JULIA_CHANNEL, createRunner());
    const projectDir = managedProjectDir(resolved.version);
    if (!managedProjectReady(projectDir)) return null;
    return { command: resolved.command, args: resolved.args, projectDir };
  } catch {
    return null;
  }
}

const ENV = await probe();

const MODEL = `using Turing

@model function eight_schools(J, y, sigma)
    mu ~ Normal(0, 5)
    tau ~ truncated(Cauchy(0, 5); lower = 0)
    theta ~ filldist(Normal(mu, tau), J)
    for j in 1:J
        y[j] ~ Normal(theta[j], sigma[j])
    end
end

build_model(data) = eight_schools(Int(data.J), Float64.(data.y), Float64.(data.sigma))
`;

// Canonical Stan-style JSON data: a flat object of numbers and numeric arrays.
const DATA = {
  J: 8,
  y: [28, 8, -3, 7, -1, 1, 18, 12],
  sigma: [15, 10, 16, 11, 9, 11, 10, 18],
};

// A model that reads its outcome from the data table inside the body rather than
// taking it as an argument. Turing only observes arguments, so without
// conditioning on the data columns this would SAMPLE `y` and `mu` would return the
// prior (mean 0); with conditioning `y` is observed and `mu` sits at the data mean.
const TABLE_MODEL = `using Turing

@model function build_model(data)
    y = data["y"]
    mu ~ Normal(0, 5)
    sigma ~ truncated(Normal(0, 2); lower = 0)
    for i in eachindex(y)
        y[i] ~ Normal(mu, sigma)
    end
end
`;

const TABLE_DATA = { y: [4.9, 5.1, 5.0, 4.7, 5.3, 5.2, 4.8, 5.05] }; // mean ~5.006

let dir: string;
let modelPath: string;

function spec(draws: number, chains: number): ResolvedSpec {
  return {
    schema_version: "0",
    backend: { id: "turing", runtime: "julia", version: DEFAULT_JULIA_CHANNEL },
    model: { kind: "file", path: modelPath, entry: "build_model" },
    sampler: { algorithm: "NUTS", draws, warmup: 200, chains, adapt_delta: 0.8 },
    data: DATA,
    output: { format: "mcmcchains-json" },
    seed: 42,
    specPath: join(dir, "spec.toml"),
    modelPath,
    specHash: "e2e",
  };
}

/** Concatenates a chain's draw batches (in seq order) into a leaf-name -> values map. */
function reconstructChain(batches: DrawBatch[], chain: number): Record<string, number[]> {
  const cols: Record<string, number[]> = {};
  for (const b of batches.filter((b) => b.chain === chain).sort((a, c) => a.seq - c.seq)) {
    for (const [leaf, values] of Object.entries(b.draws)) {
      const col = cols[leaf] ?? [];
      col.push(...values);
      cols[leaf] = col;
    }
  }
  return cols;
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "mcmcjs-e2e-"));
  modelPath = join(dir, "eight_schools.jl");
  writeFileSync(modelPath, MODEL);
});

afterAll(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

const d = ENV ? describe : describe.skip;

d("julia e2e reference (load model + JSON data, stream, reconstruct, cancel)", () => {
  it("streams draw batches that reconstruct the final samples exactly", async () => {
    const env = ENV as NonNullable<typeof ENV>;
    const outPath = join(dir, "reconstruct.samples.json");
    const batches: DrawBatch[] = [];
    const result = await runFit(
      spec(150, 2),
      { command: env.command, args: env.args },
      {
        spawn: createFitRunner(),
        projectDir: env.projectDir,
        outPath,
        recordPath: join(dir, "reconstruct.run.json"),
        onDraws: (b) => batches.push(b),
      },
    );

    expect(result.status).toBe("ok");
    const samples: Samples = parseSamples(readFileSync(outPath, "utf8"));
    expect(samples.variables.length).toBeGreaterThan(0);
    expect(batches.length).toBeGreaterThan(0);

    const chains = [...new Set(batches.map((b) => b.chain))].sort((a, c) => a - c);
    expect(chains).toEqual([0, 1]);

    // Sampler statistics stream alongside the parameters, under the names the
    // samples file records as internals.
    expect([...samples.sampleStats.keys()]).toContain("acceptance_rate");

    for (const chain of chains) {
      const cols = reconstructChain(batches, chain);
      // Every leaf the run reported appears in the stream and matches exactly,
      // parameters and sampler statistics alike.
      for (const leaf of [...samples.variables, ...samples.sampleStats.keys()]) {
        const truth = chainView(samples, leaf, chain);
        const recon = cols[leaf];
        if (!recon) throw new Error(`chain ${chain} leaf ${leaf} never appeared in the stream`);
        expect(recon).toHaveLength(truth.length);
        for (let i = 0; i < truth.length; i++) {
          expect(recon[i]).toBeCloseTo(truth[i] ?? Number.NaN, 9);
        }
      }
      // Per-chain seq is monotonic from 0.
      const seqs = batches
        .filter((b) => b.chain === chain)
        .map((b) => b.seq)
        .sort((a, c) => a - c);
      expect(seqs).toEqual(seqs.map((_, i) => i));
    }
  }, 300_000);

  it("cancels a long run mid-flight with a clean cancelled outcome", async () => {
    const env = ENV as NonNullable<typeof ENV>;
    const outPath = join(dir, "cancel.samples.json");
    const controller = new AbortController();
    // Abort as soon as sampling is underway (first streamed batch).
    let sawBatch = false;
    const onDraws = () => {
      sawBatch = true;
      controller.abort();
    };
    const result = await runFit(
      spec(50_000, 2),
      { command: env.command, args: env.args },
      {
        spawn: createFitRunner(),
        projectDir: env.projectDir,
        outPath,
        recordPath: join(dir, "cancel.run.json"),
        onDraws,
        signal: controller.signal,
      },
    );

    // Guard against a vacuous pass: the cancel is only meaningful if sampling
    // actually started and streamed before we aborted.
    expect(sawBatch, "the run ended before any draw batch streamed").toBe(true);
    expect(result.status).toBe("cancelled");
  }, 300_000);
});

d("julia e2e: an outcome read from the data table is observed, not sampled", () => {
  it("recovers the data mean, proving the outcome is conditioned", async () => {
    const env = ENV as NonNullable<typeof ENV>;
    const tableModelPath = join(dir, "table_model.jl");
    writeFileSync(tableModelPath, TABLE_MODEL);
    const outPath = join(dir, "table.samples.json");
    const result = await runFit(
      {
        ...spec(400, 2),
        model: { kind: "file", path: tableModelPath, entry: "build_model" },
        modelPath: tableModelPath,
        data: TABLE_DATA,
      },
      { command: env.command, args: env.args },
      {
        spawn: createFitRunner(),
        projectDir: env.projectDir,
        outPath,
        recordPath: join(dir, "table.run.json"),
      },
    );

    expect(result.status).toBe("ok");
    const samples: Samples = parseSamples(readFileSync(outPath, "utf8"));
    const mu = [0, 1].flatMap((chain) => Array.from(chainView(samples, "mu", chain)));
    const mean = mu.reduce((a, b) => a + b, 0) / mu.length;
    // Data mean is ~5.006; the prior mean is 0, so this only passes if `y` was
    // conditioned (observed) rather than sampled.
    expect(mean).toBeCloseTo(5.006, 0);
  }, 300_000);
});

const BUGS_MODEL = `import JuliaBUGS

const model_def = JuliaBUGS.@bugs begin
    mu ~ dnorm(0, 0.0001)
    tau ~ dgamma(0.01, 0.01)
    for i in 1:N
        y[i] ~ dnorm(mu, tau)
    end
    sigma = 1 / sqrt(tau)
end

build_model(data) = model_def(data; adtype = JuliaBUGS.ADTypes.AutoMooncake(; config = nothing))
`;

d("julia e2e: juliabugs predict recovers the posterior predictive", () => {
  it("forward-samples blanked targets per posterior draw, deterministically", async () => {
    const env = ENV as NonNullable<typeof ENV>;
    const bugsModelPath = join(dir, "normal_bugs.jl");
    writeFileSync(bugsModelPath, BUGS_MODEL);
    const bugsSpec: ResolvedSpec = {
      ...spec(300, 2),
      backend: { id: "juliabugs", runtime: "julia", version: DEFAULT_JULIA_CHANNEL },
      model: { kind: "file", path: bugsModelPath, entry: "build_model" },
      modelPath: bugsModelPath,
      data: { N: TABLE_DATA.y.length, ...TABLE_DATA },
      predict: { targets: ["y"] },
    };
    const outPath = join(dir, "bugs.samples.json");
    const fit = await runFit(
      bugsSpec,
      { command: env.command, args: env.args },
      {
        spawn: createFitRunner(),
        projectDir: env.projectDir,
        outPath,
        recordPath: join(dir, "bugs.run.json"),
      },
    );
    expect(fit.status).toBe("ok");

    const predictOnce = async (predictOut: string) =>
      runPredict(
        bugsSpec,
        { command: env.command, args: env.args },
        {
          spawn: createFitRunner(),
          projectDir: env.projectDir,
          outPath: predictOut,
          samplesPath: outPath,
        },
      );
    const p1 = join(dir, "bugs.predict.json");
    const result = await predictOnce(p1);
    expect(result.status).toBe("ok");

    const predictive: Samples = parseSamples(readFileSync(p1, "utf8"));
    const n = TABLE_DATA.y.length;
    expect([...predictive.variables].sort()).toEqual(
      Array.from({ length: n }, (_, i) => `y[${i + 1}]`).sort(),
    );
    expect(predictive.nChains).toBe(2);
    expect(predictive.nDraws).toBe(300);

    // The predictive mean tracks the data mean (~5.006); the prior mean is 0,
    // so this only passes if the posterior parameters were conditioned.
    const all = Array.from(predictive.variables).flatMap((v) =>
      [0, 1].flatMap((chain) => Array.from(chainView(predictive, v, chain))),
    );
    const mean = all.reduce((a, b) => a + b, 0) / all.length;
    expect(mean).toBeCloseTo(5.006, 0);

    // Same seed, same draws: the whole path is StableRNG-deterministic.
    const p2 = join(dir, "bugs.predict2.json");
    expect((await predictOnce(p2)).status).toBe("ok");
    expect(readFileSync(p2, "utf8")).toBe(readFileSync(p1, "utf8"));
  }, 600_000);
});

d("julia e2e: turing predict recovers the posterior predictive via FlexiChains", () => {
  it("rebuilds the posterior VNChain and forward-samples blanked targets, deterministically", async () => {
    const env = ENV as NonNullable<typeof ENV>;
    const tableModelPath = join(dir, "normal_table.jl");
    writeFileSync(tableModelPath, TABLE_MODEL);
    const tableSpec: ResolvedSpec = {
      ...spec(300, 2),
      model: { kind: "file", path: tableModelPath, entry: "build_model" },
      modelPath: tableModelPath,
      data: TABLE_DATA,
      predict: { targets: ["y"] },
    };
    const outPath = join(dir, "turing.samples.json");
    const fit = await runFit(
      tableSpec,
      { command: env.command, args: env.args },
      {
        spawn: createFitRunner(),
        projectDir: env.projectDir,
        outPath,
        recordPath: join(dir, "turing.run.json"),
      },
    );
    expect(fit.status).toBe("ok");

    const predictOnce = async (predictOut: string) =>
      runPredict(
        tableSpec,
        { command: env.command, args: env.args },
        {
          spawn: createFitRunner(),
          projectDir: env.projectDir,
          outPath: predictOut,
          samplesPath: outPath,
        },
      );
    const p1 = join(dir, "turing.predict.json");
    expect((await predictOnce(p1)).status).toBe("ok");

    const predictive: Samples = parseSamples(readFileSync(p1, "utf8"));
    const n = TABLE_DATA.y.length;
    // include_all=false: the predictive holds only the blanked targets, not the
    // conditioned latents the posterior VNChain was rebuilt from.
    expect([...predictive.variables].sort()).toEqual(
      Array.from({ length: n }, (_, i) => `y[${i + 1}]`).sort(),
    );
    expect(predictive.nChains).toBe(2);
    expect(predictive.nDraws).toBe(300);

    // The predictive mean tracks the data mean (~5.006), proving the rebuilt
    // VNChain carried the posterior parameters into predict.
    const all = Array.from(predictive.variables).flatMap((v) =>
      [0, 1].flatMap((chain) => Array.from(chainView(predictive, v, chain))),
    );
    const mean = all.reduce((a, b) => a + b, 0) / all.length;
    expect(mean).toBeCloseTo(5.006, 0);

    const p2 = join(dir, "turing.predict2.json");
    expect((await predictOnce(p2)).status).toBe("ok");
    expect(readFileSync(p2, "utf8")).toBe(readFileSync(p1, "utf8"));
  }, 600_000);
});

d("julia e2e: juliabugs streams draws that reconstruct the final samples", () => {
  it("streams named, constrained draws (parameters, generated quantities, stats)", async () => {
    const env = ENV as NonNullable<typeof ENV>;
    const bugsModelPath = join(dir, "normal_bugs_stream.jl");
    writeFileSync(bugsModelPath, BUGS_MODEL);
    const bugsSpec: ResolvedSpec = {
      ...spec(150, 2),
      backend: { id: "juliabugs", runtime: "julia", version: DEFAULT_JULIA_CHANNEL },
      model: { kind: "file", path: bugsModelPath, entry: "build_model" },
      modelPath: bugsModelPath,
      data: { N: TABLE_DATA.y.length, ...TABLE_DATA },
    };
    const outPath = join(dir, "bugs.stream.samples.json");
    const batches: DrawBatch[] = [];
    const result = await runFit(
      bugsSpec,
      { command: env.command, args: env.args },
      {
        spawn: createFitRunner(),
        projectDir: env.projectDir,
        outPath,
        recordPath: join(dir, "bugs.stream.run.json"),
        onDraws: (b) => batches.push(b),
      },
    );

    expect(result.status).toBe("ok");
    const samples: Samples = parseSamples(readFileSync(outPath, "utf8"));
    expect(batches.length).toBeGreaterThan(0);
    expect([...new Set(batches.map((b) => b.chain))].sort((a, c) => a - c)).toEqual([0, 1]);
    // sigma is a deterministic generated quantity, reconstructed per draw, not a
    // sampled parameter; it must still stream.
    expect(samples.variables).toContain("sigma");

    for (const chain of [0, 1]) {
      const cols = reconstructChain(batches, chain);
      for (const leaf of [...samples.variables, ...samples.sampleStats.keys()]) {
        const truth = chainView(samples, leaf, chain);
        const recon = cols[leaf];
        if (!recon) throw new Error(`chain ${chain} leaf ${leaf} never appeared in the stream`);
        expect(recon).toHaveLength(truth.length);
        for (let i = 0; i < truth.length; i++) {
          expect(recon[i]).toBeCloseTo(truth[i] ?? Number.NaN, 9);
        }
      }
    }
  }, 600_000);
});
