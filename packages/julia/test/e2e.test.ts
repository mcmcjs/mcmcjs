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
import { runLogLik } from "../src/loglik";
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
    sampler: {
      algorithm: "NUTS",
      draws,
      warmup: 200,
      chains,
      adapt_delta: 0.8,
      thin: 1,
      parallel: "serial",
    },
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

d("julia e2e: prior sampling and the prior predictive", () => {
  it("draws iid prior samples with the declared prior's moments", async () => {
    const env = ENV as NonNullable<typeof ENV>;
    const outPath = join(dir, "prior.samples.json");
    const result = await runFit(
      {
        ...spec(400, 2),
        sampler: {
          algorithm: "Prior",
          draws: 400,
          warmup: 0,
          chains: 2,
          adapt_delta: 0.8,
          thin: 1,
          parallel: "serial",
        },
      },
      { command: env.command, args: env.args },
      {
        spawn: createFitRunner(),
        projectDir: env.projectDir,
        outPath,
        recordPath: join(dir, "prior.run.json"),
      },
    );

    expect(result.status).toBe("ok");
    const samples: Samples = parseSamples(readFileSync(outPath, "utf8"));
    expect(samples.variables).toContain("mu");
    expect(samples.variables).toContain("theta[1]");
    const mu = [0, 1].flatMap((chain) => Array.from(chainView(samples, "mu", chain)));
    const mean = mu.reduce((a, b) => a + b, 0) / mu.length;
    const sd = Math.sqrt(mu.reduce((a, b) => a + (b - mean) ** 2, 0) / mu.length);
    // mu ~ Normal(0, 5): with 800 iid draws the mean has se 0.18 and the sd
    // concentrates near 5, so these bounds only pass for genuine prior draws.
    expect(Math.abs(mean)).toBeLessThan(1);
    expect(sd).toBeGreaterThan(4);
    expect(sd).toBeLessThan(6);
  }, 300_000);

  it("feeds predict to produce the prior predictive", async () => {
    const env = ENV as NonNullable<typeof ENV>;
    const tableModelPath = join(dir, "prior_table.jl");
    writeFileSync(tableModelPath, TABLE_MODEL);
    const priorSpec: ResolvedSpec = {
      ...spec(400, 2),
      model: { kind: "file", path: tableModelPath, entry: "build_model" },
      modelPath: tableModelPath,
      data: TABLE_DATA,
      sampler: {
        algorithm: "Prior",
        draws: 400,
        warmup: 0,
        chains: 2,
        adapt_delta: 0.8,
        thin: 1,
        parallel: "serial",
      },
      predict: { targets: ["y"] },
    };
    const priorPath = join(dir, "prior.table.samples.json");
    const fit = await runFit(
      priorSpec,
      { command: env.command, args: env.args },
      {
        spawn: createFitRunner(),
        projectDir: env.projectDir,
        outPath: priorPath,
        recordPath: join(dir, "prior.table.run.json"),
      },
    );
    expect(fit.status).toBe("ok");

    const outPath = join(dir, "prior.predict.json");
    const result = await runPredict(
      priorSpec,
      { command: env.command, args: env.args },
      {
        spawn: createFitRunner(),
        projectDir: env.projectDir,
        outPath,
        samplesPath: priorPath,
      },
    );

    expect(result.status).toBe("ok");
    const predictive: Samples = parseSamples(readFileSync(outPath, "utf8"));
    expect(predictive.variables).toContain("y[1]");
    const y1 = [0, 1]
      .flatMap((chain) => Array.from(chainView(predictive, "y[1]", chain)))
      .sort((a, b) => a - b);
    // The prior predictive follows the prior (mu centered at 0), not the data
    // (mean ~5), so the median sits near zero only if the posterior was never
    // consulted.
    const median = y1[Math.floor(y1.length / 2)] as number;
    expect(Math.abs(median)).toBeLessThan(3);
  }, 300_000);

  it("samples the juliabugs prior ancestrally with deterministic nodes intact", async () => {
    const env = ENV as NonNullable<typeof ENV>;
    const bugsModelPath = join(dir, "normal_bugs_prior.jl");
    writeFileSync(bugsModelPath, BUGS_MODEL);
    const outPath = join(dir, "bugs.prior.samples.json");
    const result = await runFit(
      {
        ...spec(300, 2),
        backend: { id: "juliabugs", runtime: "julia", version: DEFAULT_JULIA_CHANNEL },
        model: { kind: "file", path: bugsModelPath, entry: "build_model" },
        modelPath: bugsModelPath,
        data: { N: TABLE_DATA.y.length, ...TABLE_DATA },
        sampler: {
          algorithm: "Prior",
          draws: 300,
          warmup: 0,
          chains: 2,
          adapt_delta: 0.8,
          thin: 1,
          parallel: "serial",
        },
      },
      { command: env.command, args: env.args },
      {
        spawn: createFitRunner(),
        projectDir: env.projectDir,
        outPath,
        recordPath: join(dir, "bugs.prior.run.json"),
      },
    );

    expect(result.status).toBe("ok");
    const samples: Samples = parseSamples(readFileSync(outPath, "utf8"));
    expect(samples.variables).toEqual(expect.arrayContaining(["mu", "tau", "sigma"]));
    let checked = 0;
    for (const chain of [0, 1]) {
      const tau = Array.from(chainView(samples, "tau", chain));
      const sigma = Array.from(chainView(samples, "sigma", chain));
      for (let i = 0; i < tau.length; i++) {
        // The diffuse dgamma(0.01, 0.01) prior draws tau ~ 0 often enough that
        // sigma overflows; a non-finite draw is serialized as null (NaN here).
        if (!Number.isFinite(sigma[i])) continue;
        expect(sigma[i]).toBeCloseTo(1 / Math.sqrt(tau[i] as number), 6);
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(100);
    // Prior draws must ignore the data: mu ~ dnorm(0, 0.0001) has sd 100, so a
    // posterior-like concentration at the data mean (~5) would fail this.
    const mu = [0, 1].flatMap((chain) => Array.from(chainView(samples, "mu", chain)));
    const sd = Math.sqrt(
      mu.reduce((a, b) => a + b ** 2, 0) / mu.length -
        (mu.reduce((a, b) => a + b, 0) / mu.length) ** 2,
    );
    expect(sd).toBeGreaterThan(50);
  }, 300_000);
});

d("julia e2e: pointwise log-likelihood", () => {
  it("matches the chain's total loglikelihood, observation by observation", async () => {
    const env = ENV as NonNullable<typeof ENV>;
    const tableModelPath = join(dir, "loglik_table.jl");
    writeFileSync(tableModelPath, TABLE_MODEL);
    const llSpec: ResolvedSpec = {
      ...spec(200, 2),
      model: { kind: "file", path: tableModelPath, entry: "build_model" },
      modelPath: tableModelPath,
      data: TABLE_DATA,
    };
    const postPath = join(dir, "loglik.post.json");
    const fit = await runFit(
      llSpec,
      { command: env.command, args: env.args },
      {
        spawn: createFitRunner(),
        projectDir: env.projectDir,
        outPath: postPath,
        recordPath: join(dir, "loglik.post.run.json"),
      },
    );
    expect(fit.status).toBe("ok");

    const outPath = join(dir, "loglik.json");
    const result = await runLogLik(
      llSpec,
      { command: env.command, args: env.args },
      {
        spawn: createFitRunner(),
        projectDir: env.projectDir,
        outPath,
        samplesPath: postPath,
      },
    );
    expect(result.status).toBe("ok");

    const ll: Samples = parseSamples(readFileSync(outPath, "utf8"));
    const post: Samples = parseSamples(readFileSync(postPath, "utf8"));
    const n = TABLE_DATA.y.length;
    expect([...ll.variables].sort()).toEqual(
      Array.from({ length: n }, (_, i) => `y[${i + 1}]`).sort(),
    );
    expect(ll.nDraws).toBe(200);
    expect(ll.nChains).toBe(2);

    // The pointwise columns must sum to the loglikelihood the sampler recorded,
    // draw by draw: the strongest possible internal consistency check.
    for (const chain of [0, 1]) {
      const total = chainView(post, "loglikelihood", chain);
      const cols = [...ll.variables].map((v) => chainView(ll, v, chain));
      for (let i = 0; i < ll.nDraws; i++) {
        const sum = cols.reduce((a, col) => a + (col[i] as number), 0);
        expect(sum).toBeCloseTo(total[i] as number, 8);
      }
    }
  }, 600_000);

  it("computes the juliabugs pointwise log-likelihood to match the analytic logpdf", async () => {
    const env = ENV as NonNullable<typeof ENV>;
    const bugsModelPath = join(dir, "loglik_bugs.jl");
    writeFileSync(bugsModelPath, BUGS_MODEL);
    const bugsSpec: ResolvedSpec = {
      ...spec(150, 2),
      backend: { id: "juliabugs", runtime: "julia", version: DEFAULT_JULIA_CHANNEL },
      model: { kind: "file", path: bugsModelPath, entry: "build_model" },
      modelPath: bugsModelPath,
      data: { N: TABLE_DATA.y.length, ...TABLE_DATA },
    };
    const postPath = join(dir, "bugs.loglik.post.json");
    const fit = await runFit(
      bugsSpec,
      { command: env.command, args: env.args },
      {
        spawn: createFitRunner(),
        projectDir: env.projectDir,
        outPath: postPath,
        recordPath: join(dir, "bugs.loglik.post.run.json"),
      },
    );
    expect(fit.status).toBe("ok");

    const outPath = join(dir, "bugs.loglik.json");
    const result = await runLogLik(
      bugsSpec,
      { command: env.command, args: env.args },
      {
        spawn: createFitRunner(),
        projectDir: env.projectDir,
        outPath,
        samplesPath: postPath,
      },
    );
    expect(result.status).toBe("ok");

    // dnorm(mu, tau) has logpdf 0.5 log(tau/2pi) - 0.5 tau (y - mu)^2; the
    // driver's per-node walk must reproduce it at every posterior draw.
    const ll: Samples = parseSamples(readFileSync(outPath, "utf8"));
    const post: Samples = parseSamples(readFileSync(postPath, "utf8"));
    for (const chain of [0, 1]) {
      const mu = chainView(post, "mu", chain);
      const tau = chainView(post, "tau", chain);
      TABLE_DATA.y.forEach((yk, k) => {
        const col = chainView(ll, `y[${k + 1}]`, chain);
        for (let i = 0; i < ll.nDraws; i++) {
          const expected =
            -0.5 * Math.log(2 * Math.PI) +
            0.5 * Math.log(tau[i] as number) -
            0.5 * (tau[i] as number) * (yk - (mu[i] as number)) ** 2;
          expect(col[i]).toBeCloseTo(expected, 9);
        }
      });
    }
  }, 600_000);
});

d("julia e2e: the sampler matrix beyond NUTS", () => {
  it("runs HMC with an explicit adtype and thinning, recovering the data mean", async () => {
    const env = ENV as NonNullable<typeof ENV>;
    const tableModelPath = join(dir, "hmc_table.jl");
    writeFileSync(tableModelPath, TABLE_MODEL);
    const outPath = join(dir, "hmc.samples.json");
    const result = await runFit(
      {
        ...spec(150, 2),
        model: { kind: "file", path: tableModelPath, entry: "build_model" },
        modelPath: tableModelPath,
        data: TABLE_DATA,
        sampler: {
          algorithm: "HMC",
          draws: 150,
          warmup: 100,
          chains: 2,
          adapt_delta: 0.8,
          step_size: 0.05,
          leapfrog_steps: 10,
          thin: 2,
          parallel: "serial",
          adtype: "mooncake",
        },
      },
      { command: env.command, args: env.args },
      {
        spawn: createFitRunner(),
        projectDir: env.projectDir,
        outPath,
        recordPath: join(dir, "hmc.run.json"),
      },
    );

    expect(result.status).toBe("ok");
    const samples: Samples = parseSamples(readFileSync(outPath, "utf8"));
    expect(samples.nDraws).toBe(150);
    expect(samples.nChains).toBe(2);
    const mu = [0, 1].flatMap((chain) => Array.from(chainView(samples, "mu", chain)));
    const mean = mu.reduce((a, b) => a + b, 0) / mu.length;
    expect(mean).toBeCloseTo(5.006, 0);
  }, 600_000);

  it("starts MH chains exactly at the named initial values", async () => {
    const env = ENV as NonNullable<typeof ENV>;
    const tableModelPath = join(dir, "mh_table.jl");
    writeFileSync(tableModelPath, TABLE_MODEL);
    const outPath = join(dir, "mh.samples.json");
    const result = await runFit(
      {
        ...spec(50, 2),
        model: { kind: "file", path: tableModelPath, entry: "build_model" },
        modelPath: tableModelPath,
        data: TABLE_DATA,
        sampler: {
          algorithm: "MH",
          draws: 50,
          warmup: 0,
          chains: 2,
          adapt_delta: 0.8,
          thin: 1,
          parallel: "serial",
          initial_params: { mu: 42.0, sigma: 1.0 },
        },
      },
      { command: env.command, args: env.args },
      {
        spawn: createFitRunner(),
        projectDir: env.projectDir,
        outPath,
        recordPath: join(dir, "mh.run.json"),
      },
    );

    expect(result.status).toBe("ok");
    const samples: Samples = parseSamples(readFileSync(outPath, "utf8"));
    // With no burn-in the first retained state is the initial value itself.
    expect(chainView(samples, "mu", 0)[0]).toBe(42);
    expect(chainView(samples, "mu", 1)[0]).toBe(42);
  }, 600_000);
});

d("julia e2e: Gibbs, particle samplers, external samplers, distributed chains", () => {
  const tableSampler = {
    draws: 150,
    warmup: 150,
    chains: 2,
    adapt_delta: 0.8,
    thin: 1,
    parallel: "serial",
  } as const;

  function tableSpec(name: string, sampler: ResolvedSpec["sampler"]): ResolvedSpec {
    const path = join(dir, `${name}_table.jl`);
    writeFileSync(path, TABLE_MODEL);
    return {
      ...spec(sampler.draws, sampler.chains),
      model: { kind: "file", path, entry: "build_model" },
      modelPath: path,
      data: TABLE_DATA,
      sampler,
    };
  }

  const io = (name: string) => ({
    spawn: createFitRunner(),
    projectDir: (ENV as NonNullable<typeof ENV>).projectDir,
    outPath: join(dir, `${name}.samples.json`),
    recordPath: join(dir, `${name}.run.json`),
  });

  function muMean(name: string, chains: number): number {
    const samples: Samples = parseSamples(readFileSync(join(dir, `${name}.samples.json`), "utf8"));
    const mu = Array.from({ length: chains }, (_, c) =>
      Array.from(chainView(samples, "mu", c)),
    ).flat();
    return mu.reduce((a, b) => a + b, 0) / mu.length;
  }

  it("composes Gibbs blocks (NUTS for mu, MH for sigma) and recovers the data mean", async () => {
    const env = ENV as NonNullable<typeof ENV>;
    const result = await runFit(
      tableSpec("gibbs", {
        ...tableSampler,
        algorithm: "Gibbs",
        blocks: [
          { variables: ["mu"], algorithm: "NUTS", adapt_delta: 0.8 },
          { variables: ["sigma"], algorithm: "MH", adapt_delta: 0.8 },
        ],
      }),
      { command: env.command, args: env.args },
      io("gibbs"),
    );
    expect(result.status).toBe("ok");
    expect(muMean("gibbs", 2)).toBeCloseTo(5.006, 0);
    // A frozen NUTS block would still pass the mean check; require real movement.
    const samples = parseSamples(readFileSync(join(dir, "gibbs.samples.json"), "utf8"));
    for (const chain of [0, 1]) {
      const unique = new Set(chainView(samples, "mu", chain)).size;
      expect(unique).toBeGreaterThan(samples.nDraws / 2);
    }
  }, 600_000);

  it("runs the particle samplers (SMC keeps every draw, PG discards warmup)", async () => {
    const env = ENV as NonNullable<typeof ENV>;
    const smc = await runFit(
      tableSpec("smc", { ...tableSampler, algorithm: "SMC", draws: 400 }),
      { command: env.command, args: env.args },
      io("smc"),
    );
    expect(smc.status).toBe("ok");
    const smcSamples = parseSamples(readFileSync(join(dir, "smc.samples.json"), "utf8"));
    expect(smcSamples.nDraws).toBe(400);
    expect(muMean("smc", 2)).toBeCloseTo(5.006, 0);

    const pg = await runFit(
      tableSpec("pg", { ...tableSampler, algorithm: "PG", particles: 15 }),
      { command: env.command, args: env.args },
      io("pg"),
    );
    expect(pg.status).toBe("ok");
    expect(muMean("pg", 2)).toBeCloseTo(5.006, 0);
  }, 600_000);

  it("wraps the model file's MCMC_SAMPLER via External, and errors without one", async () => {
    const env = ENV as NonNullable<typeof ENV>;
    const extModelPath = join(dir, "ext_sampler.jl");
    writeFileSync(
      extModelPath,
      `import AdvancedHMC\nconst MCMC_SAMPLER = AdvancedHMC.NUTS(0.8)\n${TABLE_MODEL}`,
    );
    const extSpec = tableSpec("ext", { ...tableSampler, algorithm: "External" });
    const result = await runFit(
      { ...extSpec, model: { ...extSpec.model, path: extModelPath }, modelPath: extModelPath },
      { command: env.command, args: env.args },
      io("ext"),
    );
    expect(result.status).toBe("ok");
    expect(muMean("ext", 2)).toBeCloseTo(5.006, 0);

    const missing = await runFit(
      tableSpec("ext_missing", { ...tableSampler, algorithm: "External" }),
      { command: env.command, args: env.args },
      io("ext_missing"),
    );
    expect(missing.status).toBe("error");
    expect(missing.error).toContain("MCMC_SAMPLER");
  }, 600_000);

  it("samples distributed chains on worker processes and recovers the data mean", async () => {
    const env = ENV as NonNullable<typeof ENV>;
    const result = await runFit(
      tableSpec("dist", { ...tableSampler, algorithm: "NUTS", parallel: "distributed" }),
      { command: env.command, args: env.args },
      io("dist"),
    );
    expect(result.status).toBe("ok");
    const samples = parseSamples(readFileSync(join(dir, "dist.samples.json"), "utf8"));
    expect(samples.nChains).toBe(2);
    expect(muMean("dist", 2)).toBeCloseTo(5.006, 0);
  }, 900_000);
});

d("julia e2e: model-declared MCMC defaults", () => {
  const DEFAULTS_MODEL = `using Turing

const MCMC_DEFAULTS = (; adtype = "nosuch")

@model function build_model(data)
    y = data["y"]
    mu ~ Normal(0, 5)
    for i in eachindex(y)
        y[i] ~ Normal(mu, 1)
    end
end
`;

  it("applies the model's adtype default and lets the spec override it", async () => {
    const env = ENV as NonNullable<typeof ENV>;
    const path = join(dir, "defaults_model.jl");
    writeFileSync(path, DEFAULTS_MODEL);
    const base = {
      ...spec(20, 1),
      model: { kind: "file", path, entry: "build_model" } as const,
      modelPath: path,
      data: { y: [5.0, 5.1] },
    };
    const io = (name: string) => ({
      spawn: createFitRunner(),
      projectDir: env.projectDir,
      outPath: join(dir, `${name}.samples.json`),
      recordPath: join(dir, `${name}.run.json`),
    });

    // The deliberately invalid default is observable: without a spec adtype the
    // fit fails on it, proving the default reached the sampler.
    const applied = await runFit(base, { command: env.command, args: env.args }, io("dflt"));
    expect(applied.status).toBe("error");
    expect(applied.error).toContain("unsupported adtype: nosuch");

    // A spec adtype wins over the model default.
    const overridden = await runFit(
      {
        ...base,
        sampler: { ...base.sampler, adtype: "forwarddiff" },
      },
      { command: env.command, args: env.args },
      io("ovrd"),
    );
    expect(overridden.status).toBe("ok");

    // A gradient-free sampler never consults the default.
    const mh = await runFit(
      {
        ...base,
        sampler: {
          algorithm: "MH",
          draws: 20,
          warmup: 0,
          chains: 1,
          adapt_delta: 0.8,
          thin: 1,
          parallel: "serial",
        },
      },
      { command: env.command, args: env.args },
      io("mh_dflt"),
    );
    expect(mh.status).toBe("ok");
  }, 600_000);
});

// A two-component mixture: z indexes mu, so the log density is a function of a
// discrete latent. Marginalization sums z out; the environment-based samplers
// propose it instead. The priors are separated so labels cannot swap.
const MIXTURE_MODEL = `import JuliaBUGS

const model_def = JuliaBUGS.@bugs begin
    mu[1] ~ dnorm(-3, 1)
    mu[2] ~ dnorm(3, 1)
    for i in 1:N
        z[i] ~ dcat(w[1:2])
        y[i] ~ dnorm(mu[z[i]], 1)
    end
end

build_model(data) = JuliaBUGS.compile(model_def, data)
`;

const MIXTURE_DATA = {
  N: 10,
  w: [0.5, 0.5],
  y: [-3.2, -2.8, -3.1, -2.9, -3.3, 3.1, 2.9, 3.2, 2.8, 3.3],
};

/** Pooled mean of one variable across every chain. */
function pooledMean(samples: Samples, variable: string): number {
  let sum = 0;
  let n = 0;
  for (let c = 0; c < samples.nChains; c++) {
    for (const v of chainView(samples, variable, c)) {
      sum += v;
      n += 1;
    }
  }
  return sum / n;
}

d("julia e2e: juliabugs discrete latents through every sampler", () => {
  let mixturePath: string;

  beforeAll(() => {
    mixturePath = join(dir, "mixture_bugs.jl");
    writeFileSync(mixturePath, MIXTURE_MODEL);
  });

  const mixtureSpec = (sampler: ResolvedSpec["sampler"], mode?: "marginalized"): ResolvedSpec => ({
    ...spec(200, 2),
    backend: { id: "juliabugs", runtime: "julia", version: DEFAULT_JULIA_CHANNEL },
    model: { kind: "file", path: mixturePath, entry: "build_model", evaluation_mode: mode },
    modelPath: mixturePath,
    sampler,
    data: MIXTURE_DATA,
  });

  const nuts = (extra: Partial<ResolvedSpec["sampler"]> = {}): ResolvedSpec["sampler"] => ({
    algorithm: "NUTS",
    draws: 200,
    warmup: 200,
    chains: 2,
    adapt_delta: 0.8,
    thin: 1,
    parallel: "serial",
    ...extra,
  });

  const fitMixture = async (
    name: string,
    sampler: ResolvedSpec["sampler"],
    mode?: "marginalized",
  ) => {
    const env = ENV as NonNullable<typeof ENV>;
    const outPath = join(dir, `${name}.samples.json`);
    const result = await runFit(
      mixtureSpec(sampler, mode),
      { command: env.command, args: env.args },
      {
        spawn: createFitRunner(),
        projectDir: env.projectDir,
        outPath,
        recordPath: join(dir, `${name}.run.json`),
      },
    );
    return { result, outPath };
  };

  it("marginalizes the latents out under NUTS and still reports them", async () => {
    const { result, outPath } = await fitMixture("mix_marginal", nuts(), "marginalized");
    expect(result.status).toBe("ok");

    const samples: Samples = parseSamples(readFileSync(outPath, "utf8"));
    // The latents are summed out of the log density, yet recovered from
    // p(z | mu, y) for the chain, so every state appears as a column.
    for (const leaf of ["mu[1]", "mu[2]", "z[1]", "z[10]"]) {
      expect(samples.variables).toContain(leaf);
    }
    expect(pooledMean(samples, "mu[1]")).toBeCloseTo(-3.0, 0);
    expect(pooledMean(samples, "mu[2]")).toBeCloseTo(3.0, 0);
    // Every draw assigns the first observation to the negative component.
    expect(pooledMean(samples, "z[1]")).toBe(1);
    expect(pooledMean(samples, "z[10]")).toBe(2);
  }, 900_000);

  it("moves the discrete latents itself under MH", async () => {
    const { result, outPath } = await fitMixture("mix_mh", {
      ...nuts(),
      algorithm: "MH",
      warmup: 500,
      draws: 500,
    });
    expect(result.status).toBe("ok");

    const samples: Samples = parseSamples(readFileSync(outPath, "utf8"));
    expect(samples.variables).toContain("z[1]");
    expect(pooledMean(samples, "mu[1]")).toBeLessThan(0);
    expect(pooledMean(samples, "mu[2]")).toBeGreaterThan(0);
    expect(pooledMean(samples, "z[1]")).toBe(1);
  }, 900_000);

  it("splits the continuous and discrete parameters across Gibbs blocks", async () => {
    const { result, outPath } = await fitMixture("mix_gibbs", {
      ...nuts(),
      algorithm: "Gibbs",
      adtype: "forwarddiff",
      blocks: [
        { variables: ["mu"], algorithm: "NUTS", adapt_delta: 0.8 },
        { variables: ["z"], algorithm: "MH", adapt_delta: 0.8 },
      ],
    });
    expect(result.status).toBe("ok");

    const samples: Samples = parseSamples(readFileSync(outPath, "utf8"));
    expect(pooledMean(samples, "mu[1]")).toBeLessThan(0);
    expect(pooledMean(samples, "mu[2]")).toBeGreaterThan(0);
    expect(pooledMean(samples, "z[1]")).toBe(1);
  }, 900_000);

  it("rejects a Gibbs map that does not cover every parameter", async () => {
    const { result } = await fitMixture("mix_gibbs_partial", {
      ...nuts(),
      algorithm: "Gibbs",
      blocks: [{ variables: ["mu"], algorithm: "MH", adapt_delta: 0.8 }],
    });
    expect(result.status).toBe("error");
    expect(result.error).toMatch(/z/);
  }, 900_000);

  it("reaches the same marginalized posterior through each AD backend", async () => {
    const means: number[] = [];
    for (const adtype of ["forwarddiff", "reversediff", "mooncake"] as const) {
      const { result, outPath } = await fitMixture(
        `mix_${adtype}`,
        nuts({ adtype }),
        "marginalized",
      );
      expect(result.status).toBe("ok");
      means.push(pooledMean(parseSamples(readFileSync(outPath, "utf8")), "mu[1]"));
    }
    for (const mean of means) expect(mean).toBeCloseTo(means[0] as number, 1);
  }, 1_800_000);

  it("starts from spec-named initial values, and rejects a name the model lacks", async () => {
    const started = await fitMixture(
      "mix_inits",
      nuts({ initial_params: { mu: [-3, 3] } }),
      "marginalized",
    );
    expect(started.result.status).toBe("ok");
    expect(pooledMean(parseSamples(readFileSync(started.outPath, "utf8")), "mu[1]")).toBeCloseTo(
      -3.0,
      0,
    );

    const typo = await fitMixture("mix_inits_typo", nuts({ initial_params: { nu: [-3, 3] } }));
    expect(typo.result.status).toBe("error");
    expect(typo.result.error).toMatch(/initial_params names nu/);
  }, 900_000);
});

d("julia e2e: juliabugs evaluation modes agree", () => {
  it("reaches the same posterior through graph and generated log densities", async () => {
    const env = ENV as NonNullable<typeof ENV>;
    const bugsModelPath = join(dir, "normal_bugs_modes.jl");
    writeFileSync(bugsModelPath, BUGS_MODEL);

    const fitMode = async (mode: "graph" | "generated") => {
      const outPath = join(dir, `modes_${mode}.samples.json`);
      const result = await runFit(
        {
          ...spec(300, 2),
          backend: { id: "juliabugs", runtime: "julia", version: DEFAULT_JULIA_CHANNEL },
          model: {
            kind: "file",
            path: bugsModelPath,
            entry: "build_model",
            evaluation_mode: mode,
          },
          modelPath: bugsModelPath,
          sampler: { ...spec(300, 2).sampler, adtype: "mooncake" },
          data: { N: TABLE_DATA.y.length, ...TABLE_DATA },
        },
        { command: env.command, args: env.args },
        {
          spawn: createFitRunner(),
          projectDir: env.projectDir,
          outPath,
          recordPath: join(dir, `modes_${mode}.run.json`),
        },
      );
      expect(result.status).toBe("ok");
      return parseSamples(readFileSync(outPath, "utf8"));
    };

    const graph = await fitMode("graph");
    const generated = await fitMode("generated");
    // Same model, same seed, two log-density implementations: the posterior mean
    // must agree even though the sampler paths are not draw-for-draw identical.
    expect(pooledMean(generated, "mu")).toBeCloseTo(pooledMean(graph, "mu"), 1);
    expect(pooledMean(generated, "sigma")).toBeCloseTo(pooledMean(graph, "sigma"), 1);
  }, 1_200_000);
});
