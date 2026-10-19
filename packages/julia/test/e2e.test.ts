import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  chainView,
  DEFAULT_JULIA_CHANNEL,
  parseSamples,
  type ResolvedSpec,
  type Samples,
} from "@mcmcjs/core";
import {
  createFitRunner,
  createRunner,
  type DrawBatch,
  type FitProgress,
  type WarmupCheckpoint,
} from "@mcmcjs/engine";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { detectJuliaup } from "../src/environment";
import { runFit } from "../src/fit";
import { runLogLik } from "../src/loglik";
import { parseObservedData, runObserved } from "../src/observed";
import { runPredict } from "../src/predict";
import { managedProjectDir, managedProjectReady } from "../src/project";
import { resolveVersion } from "../src/versions";

/**
 * The seeded end-to-end reference: a real Julia fit that loads a model plus
 * Stan-style JSON data, streams draw batches, reconstructs the final samples
 * from them, and cancels a separate run mid-flight. It drives actual Julia, so
 * it is opt-in: without MCMC_E2E=1 the whole file skips. Run it with:
 * MCMC_E2E=1 pnpm -F @mcmcjs/julia test e2e
 *
 * With MCMC_E2E=1 an unusable environment is an error, not a skip. Changing the
 * managed package set invalidates the provisioning sentinel, so a suite that
 * skipped quietly would report green while testing nothing.
 */
async function probe(): Promise<{ command: string; args: string[]; projectDir: string } | null> {
  if (process.env.MCMC_E2E !== "1") return null;
  const juliaup = await detectJuliaup();
  if (!juliaup.found || !juliaup.path) throw new Error("MCMC_E2E=1 but juliaup was not found");
  const resolved = await resolveVersion(juliaup.path, DEFAULT_JULIA_CHANNEL, createRunner());
  const projectDir = managedProjectDir(resolved.version);
  if (!managedProjectReady(projectDir)) {
    throw new Error(
      `MCMC_E2E=1 but the managed Julia project at ${projectDir} is not provisioned with the current package set; run a fit (or mcmc setup julia) first`,
    );
  }
  return { command: resolved.command, args: resolved.args, projectDir };
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
  it("replays one original threaded chain without sampling its siblings", async () => {
    const env = ENV as NonNullable<typeof ENV>;
    const invocation = { command: env.command, args: env.args };
    const fullSpec = spec(8, 2);
    fullSpec.sampler.warmup = 10;
    fullSpec.sampler.parallel = "threads";
    const fullPath = join(dir, "selected-full.json");
    const full = await runFit(fullSpec, invocation, {
      spawn: createFitRunner(),
      projectDir: env.projectDir,
      outPath: fullPath,
    });
    expect(full.status, full.error).toBe("ok");

    const selectedSpec = spec(8, 1);
    selectedSpec.sampler.warmup = 10;
    const selectedPath = join(dir, "selected-chain.json");
    const checkpointDir = join(dir, "selected-checkpoints");
    const batches: DrawBatch[] = [];
    const selected = await runFit(selectedSpec, invocation, {
      spawn: createFitRunner(),
      projectDir: env.projectDir,
      outPath: selectedPath,
      checkpointDir,
      checkpointScopeSha256: "c".repeat(64),
      chainSelection: { index: 1, count: 2 },
      onDraws: (batch) => batches.push(batch),
    });
    expect(selected.status, selected.error).toBe("ok");
    expect(batches.map((batch) => [batch.chain, batch.seq, batch.iteration])).toEqual([[1, 0, 8]]);
    expect(existsSync(join(checkpointDir, "chain-1-iteration-8.bin"))).toBe(true);

    const baseline = parseSamples(readFileSync(fullPath, "utf8"));
    const replayed = parseSamples(readFileSync(selectedPath, "utf8"));
    for (const leaf of [...baseline.variables, ...baseline.sampleStats.keys()]) {
      expect(Array.from(chainView(replayed, leaf, 0))).toEqual(
        Array.from(chainView(baseline, leaf, 1)),
      );
    }
  }, 900_000);

  it("restores both threaded NUTS chains from batch-boundary checkpoints", async () => {
    const env = ENV as NonNullable<typeof ENV>;
    const invocation = { command: env.command, args: env.args };
    const strictInvocation = { command: env.command, args: [...env.args, "--depwarn=error"] };
    const fullSpec = spec(60, 2);
    fullSpec.sampler.warmup = 20;
    fullSpec.sampler.parallel = "threads";
    const fullPath = join(dir, "checkpoint-full.json");
    const full = await runFit(fullSpec, invocation, {
      spawn: createFitRunner(),
      projectDir: env.projectDir,
      outPath: fullPath,
    });
    expect(full.status, full.error).toBe("ok");

    const partialSpec = spec(40, 2);
    partialSpec.sampler.warmup = 20;
    partialSpec.sampler.parallel = "threads";
    const partialPath = join(dir, "checkpoint-partial.json");
    const checkpointDir = join(dir, "checkpoints");
    const checkpointScopeSha256 = "a".repeat(64);
    const batches: DrawBatch[] = [];
    const partial = await runFit(partialSpec, strictInvocation, {
      spawn: createFitRunner(),
      projectDir: env.projectDir,
      outPath: partialPath,
      checkpointDir,
      checkpointScopeSha256,
      drawBatchSize: 10,
      onDraws: (batch) => batches.push(batch),
    });
    expect(partial.status, partial.error).toBe("ok");

    const fullSamples = parseSamples(readFileSync(fullPath, "utf8"));
    const partialSamples = parseSamples(readFileSync(partialPath, "utf8"));
    const leaves = [...fullSamples.variables, ...fullSamples.sampleStats.keys()];
    expect(batches).toHaveLength(8);
    for (const batch of batches) {
      const checkpoint = batch.checkpoint;
      expect(checkpoint).toBeDefined();
      if (!checkpoint) continue;
      expect(checkpoint.path).toBe(
        join(checkpointDir, `chain-${batch.chain}-iteration-${batch.iteration}.bin`),
      );
      expect(checkpoint.sha256).toBe(
        createHash("sha256").update(readFileSync(checkpoint.path)).digest("hex"),
      );
    }
    const rejected = await runFit(spec(1, 1), invocation, {
      spawn: createFitRunner(),
      projectDir: env.projectDir,
      outPath: join(dir, "checkpoint-rejected.json"),
      resumeFrom: join(checkpointDir, "chain-0-iteration-40.bin"),
      resumeSha256: "0".repeat(64),
      checkpointScopeSha256,
    });
    expect(rejected.status).toBe("error");
    expect(rejected.error).toContain("checkpoint SHA-256 does not match");
    const scopeMismatchSpec = spec(1, 1);
    scopeMismatchSpec.sampler.warmup = 20;
    const scopeMismatch = await runFit(scopeMismatchSpec, invocation, {
      spawn: createFitRunner(),
      projectDir: env.projectDir,
      outPath: join(dir, "checkpoint-scope-rejected.json"),
      resumeFrom: join(checkpointDir, "chain-0-iteration-40.bin"),
      resumeSha256: createHash("sha256")
        .update(readFileSync(join(checkpointDir, "chain-0-iteration-40.bin")))
        .digest("hex"),
      checkpointScopeSha256: "b".repeat(64),
    });
    expect(scopeMismatch.status).toBe("error");
    expect(scopeMismatch.error).toContain("checkpoint checkpoint_scope_sha256 does not match");
    for (const chain of [0, 1]) {
      const checkpoint = join(checkpointDir, `chain-${chain}-iteration-40.bin`);
      expect(existsSync(join(checkpointDir, `chain-${chain}-iteration-10.bin`))).toBe(true);
      expect(existsSync(checkpoint)).toBe(true);
      const resumedSpec = spec(20, 1);
      resumedSpec.sampler.warmup = 20;
      const resumedPath = join(dir, `checkpoint-resumed-${chain}.json`);
      const resumedBatches: DrawBatch[] = [];
      const resumed = await runFit(resumedSpec, strictInvocation, {
        spawn: createFitRunner(),
        projectDir: env.projectDir,
        outPath: resumedPath,
        resumeFrom: checkpoint,
        resumeSha256: createHash("sha256").update(readFileSync(checkpoint)).digest("hex"),
        checkpointDir: join(dir, `resumed-${chain}`),
        checkpointScopeSha256,
        drawBatchSize: 10,
        onDraws: (batch) => resumedBatches.push(batch),
      });
      expect(resumed.status, resumed.error).toBe("ok");
      expect(existsSync(join(dir, `resumed-${chain}`, `chain-${chain}-iteration-60.bin`))).toBe(
        true,
      );
      expect(
        resumedBatches.map(({ chain: id, seq, iteration }) => ({ id, seq, iteration })),
      ).toEqual([
        { id: chain, seq: 4, iteration: 50 },
        { id: chain, seq: 5, iteration: 60 },
      ]);
      const tail = parseSamples(readFileSync(resumedPath, "utf8"));
      for (const leaf of leaves) {
        const expected = Array.from(chainView(fullSamples, leaf, chain));
        expect(Array.from(chainView(partialSamples, leaf, chain))).toEqual(expected.slice(0, 40));
        expect(Array.from(chainView(tail, leaf, 0))).toEqual(expected.slice(40));
      }
    }
  }, 900_000);

  it("restores Turing NUTS from a warmup checkpoint", async () => {
    const env = ENV as NonNullable<typeof ENV>;
    const invocation = { command: env.command, args: env.args };
    const configured = spec(6, 1);
    configured.sampler.warmup = 10;
    const baselinePath = join(dir, "warmup-baseline.json");
    const baseline = await runFit(configured, invocation, {
      spawn: createFitRunner(),
      projectDir: env.projectDir,
      outPath: baselinePath,
    });
    expect(baseline.status, baseline.error).toBe("ok");

    const checkpointDir = join(dir, "warmup-checkpoints");
    const scope = "a".repeat(64);
    const controller = new AbortController();
    const warmupCheckpoints: WarmupCheckpoint[] = [];
    const interrupted = await runFit(configured, invocation, {
      spawn: createFitRunner(),
      projectDir: env.projectDir,
      outPath: join(dir, "warmup-interrupted.json"),
      checkpointDir,
      checkpointScopeSha256: scope,
      drawBatchSize: 3,
      signal: controller.signal,
      onWarmupCheckpoint: (checkpoint) => {
        warmupCheckpoints.push(checkpoint);
        if (checkpoint.iteration === 6) controller.abort();
      },
    });
    expect(interrupted.status).toBe("cancelled");
    expect(warmupCheckpoints.map(({ iteration }) => iteration)).toEqual([3, 6]);
    for (const saved of warmupCheckpoints) {
      expect(saved.chain).toBe(0);
      expect(saved.warmup).toBe(10);
      expect(saved.checkpoint.sha256).toBe(
        createHash("sha256").update(readFileSync(saved.checkpoint.path)).digest("hex"),
      );
    }
    const checkpoint = join(checkpointDir, "chain-0-warmup-6.bin");
    expect(existsSync(checkpoint)).toBe(true);
    const resumedCheckpointDir = join(dir, "warmup-resumed-checkpoints");
    const secondController = new AbortController();
    const continuedWarmup: WarmupCheckpoint[] = [];
    const interruptedAgain = await runFit(configured, invocation, {
      spawn: createFitRunner(),
      projectDir: env.projectDir,
      outPath: join(dir, "warmup-interrupted-again.json"),
      resumeFrom: checkpoint,
      resumeSha256: createHash("sha256").update(readFileSync(checkpoint)).digest("hex"),
      checkpointScopeSha256: scope,
      checkpointDir: resumedCheckpointDir,
      drawBatchSize: 3,
      signal: secondController.signal,
      onWarmupCheckpoint: (saved) => {
        continuedWarmup.push(saved);
        if (saved.iteration === 10) secondController.abort();
      },
    });
    expect(interruptedAgain.status).toBe("cancelled");
    expect(continuedWarmup.map(({ iteration, warmup }) => ({ iteration, warmup }))).toEqual([
      { iteration: 9, warmup: 10 },
      { iteration: 10, warmup: 10 },
    ]);
    const secondCheckpoint = join(resumedCheckpointDir, "chain-0-warmup-10.bin");
    expect(existsSync(secondCheckpoint)).toBe(true);
    const resumedPath = join(dir, "warmup-resumed.json");
    const batches: DrawBatch[] = [];
    const resumed = await runFit(configured, invocation, {
      spawn: createFitRunner(),
      projectDir: env.projectDir,
      outPath: resumedPath,
      resumeFrom: secondCheckpoint,
      resumeSha256: createHash("sha256").update(readFileSync(secondCheckpoint)).digest("hex"),
      checkpointScopeSha256: scope,
      checkpointDir: join(dir, "warmup-final-checkpoints"),
      drawBatchSize: 3,
      onDraws: (batch) => batches.push(batch),
    });
    expect(resumed.status, resumed.error).toBe("ok");
    expect(batches.map(({ seq, iteration }) => ({ seq, iteration }))).toEqual([
      { seq: 0, iteration: 3 },
      { seq: 1, iteration: 6 },
    ]);
    const baselineSamples = parseSamples(readFileSync(baselinePath, "utf8"));
    const resumedSamples = parseSamples(readFileSync(resumedPath, "utf8"));
    for (const leaf of [...baselineSamples.variables, ...baselineSamples.sampleStats.keys()]) {
      const expected = Array.from(chainView(baselineSamples, leaf, 0));
      expect(Array.from(chainView(resumedSamples, leaf, 0))).toEqual(expected);
    }
  }, 900_000);

  it("keeps the selected chain index in continued warmup checkpoints", async () => {
    const env = ENV as NonNullable<typeof ENV>;
    const invocation = { command: env.command, args: env.args };
    const configured = spec(2, 1);
    configured.sampler.warmup = 6;
    const scope = "b".repeat(64);
    const checkpointDir = join(dir, "selected-warmup-checkpoints");
    const controller = new AbortController();
    const first = await runFit(configured, invocation, {
      spawn: createFitRunner(),
      projectDir: env.projectDir,
      outPath: join(dir, "selected-warmup-interrupted.json"),
      checkpointDir,
      checkpointScopeSha256: scope,
      chainSelection: { index: 1, count: 2 },
      drawBatchSize: 3,
      signal: controller.signal,
      onWarmupCheckpoint: (checkpoint) => {
        expect(checkpoint.chain).toBe(1);
        controller.abort();
      },
    });
    expect(first.status).toBe("cancelled");
    const saved = join(checkpointDir, "chain-1-warmup-3.bin");
    expect(existsSync(saved)).toBe(true);
    const continued: WarmupCheckpoint[] = [];
    const second = await runFit(configured, invocation, {
      spawn: createFitRunner(),
      projectDir: env.projectDir,
      outPath: join(dir, "selected-warmup-resumed.json"),
      resumeFrom: saved,
      resumeSha256: createHash("sha256").update(readFileSync(saved)).digest("hex"),
      checkpointScopeSha256: scope,
      checkpointDir: join(dir, "selected-warmup-resumed-checkpoints"),
      drawBatchSize: 3,
      onWarmupCheckpoint: (checkpoint) => continued.push(checkpoint),
    });
    expect(second.status, second.error).toBe("ok");
    expect(continued.map(({ chain, iteration }) => ({ chain, iteration }))).toEqual([
      { chain: 1, iteration: 6 },
    ]);
  }, 900_000);

  it("streams threaded Turing draws from both chains", async () => {
    const env = ENV as NonNullable<typeof ENV>;
    const outPath = join(dir, "threaded-turing.samples.json");
    const batches: DrawBatch[] = [];
    const progress: FitProgress[] = [];
    const configured = spec(60, 2);
    configured.sampler.warmup = 60;
    configured.sampler.parallel = "threads";
    const result = await runFit(
      configured,
      { command: env.command, args: env.args },
      {
        spawn: createFitRunner(),
        projectDir: env.projectDir,
        outPath,
        onDraws: (b) => batches.push(b),
        onProgress: (p) => progress.push(p),
      },
    );
    expect(result.status, result.error).toBe("ok");
    expect([...new Set(progress.map((p) => p.chain))].sort((a, b) => a - b)).toEqual([1, 2]);
    const samples = parseSamples(readFileSync(outPath, "utf8"));
    expect([...new Set(batches.map((b) => b.chain))].sort((a, b) => a - b)).toEqual([0, 1]);
    for (const chain of [0, 1]) {
      const seqs = batches.filter((b) => b.chain === chain).map((b) => b.seq);
      expect(seqs).toEqual(seqs.map((_, i) => i));
      const columns = reconstructChain(batches, chain);
      for (const leaf of [...samples.variables, ...samples.sampleStats.keys()]) {
        expect(columns[leaf]).toEqual(Array.from(chainView(samples, leaf, chain)));
      }
    }
  }, 600_000);

  it("caps Turing NUTS tree depth in a real fit", async () => {
    const env = ENV as NonNullable<typeof ENV>;
    const outPath = join(dir, "depth.samples.json");
    const configured = spec(30, 1);
    configured.sampler.warmup = 30;
    configured.sampler.max_depth = 1;
    const result = await runFit(
      configured,
      { command: env.command, args: env.args },
      { spawn: createFitRunner(), projectDir: env.projectDir, outPath },
    );
    expect(result.status).toBe("ok");
    const samples = parseSamples(readFileSync(outPath, "utf8"));
    const depths = samples.sampleStats.get("tree_depth");
    expect(depths).toBeDefined();
    expect([...(depths ?? [])].every((depth) => depth <= 1)).toBe(true);
  }, 300_000);

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

  it("waits for an asynchronous draw consumer in a real fit", async () => {
    const env = ENV as NonNullable<typeof ENV>;
    const outPath = join(dir, "async-stream.samples.json");
    const batches: DrawBatch[] = [];
    const configured = spec(80, 1);
    configured.sampler.warmup = 20;
    let active = 0;
    let maxActive = 0;
    const result = await runFit(
      configured,
      { command: env.command, args: env.args },
      {
        spawn: createFitRunner(),
        projectDir: env.projectDir,
        outPath,
        drawBatchSize: 10,
        onDraws: async (batch) => {
          active++;
          maxActive = Math.max(maxActive, active);
          await new Promise((resolve) => setTimeout(resolve, 25));
          batches.push(batch);
          active--;
        },
      },
    );

    expect(result.status, result.error).toBe("ok");
    expect(maxActive).toBe(1);
    expect(active).toBe(0);
    expect(batches).toHaveLength(8);
    const samples = parseSamples(readFileSync(outPath, "utf8"));
    const columns = reconstructChain(batches, 0);
    for (const leaf of [...samples.variables, ...samples.sampleStats.keys()]) {
      expect(columns[leaf]).toEqual(Array.from(chainView(samples, leaf, 0)));
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
  it("continues a generated-mode NUTS chain after a batch boundary", async () => {
    const env = ENV as NonNullable<typeof ENV>;
    const model = join(dir, "generated-checkpoint-bugs.jl");
    writeFileSync(model, BUGS_MODEL);
    const configured: ResolvedSpec = {
      ...spec(8, 1),
      backend: { id: "juliabugs", runtime: "julia", version: DEFAULT_JULIA_CHANNEL },
      model: {
        kind: "file",
        path: model,
        entry: "build_model",
        evaluation_mode: "generated",
      },
      modelPath: model,
      data: { N: TABLE_DATA.y.length, ...TABLE_DATA },
    };
    configured.sampler.warmup = 10;
    const invocation = { command: env.command, args: env.args };
    const fullPath = join(dir, "generated-checkpoint-full.json");
    const full = await runFit(configured, invocation, {
      spawn: createFitRunner(),
      projectDir: env.projectDir,
      outPath: fullPath,
    });
    expect(full.status, full.error).toBe("ok");

    const partialPath = join(dir, "generated-checkpoint-partial.json");
    const checkpointDir = join(dir, "generated-checkpoints");
    const partial = await runFit(
      { ...configured, sampler: { ...configured.sampler, draws: 4 } },
      invocation,
      {
        spawn: createFitRunner(),
        projectDir: env.projectDir,
        outPath: partialPath,
        checkpointDir,
        checkpointScopeSha256: "f".repeat(64),
        drawBatchSize: 4,
      },
    );
    expect(partial.status, partial.error).toBe("ok");
    const checkpoint = join(checkpointDir, "chain-0-iteration-4.bin");
    const tailPath = join(dir, "generated-checkpoint-tail.json");
    const tail = await runFit(
      { ...configured, sampler: { ...configured.sampler, draws: 4 } },
      invocation,
      {
        spawn: createFitRunner(),
        projectDir: env.projectDir,
        outPath: tailPath,
        resumeFrom: checkpoint,
        resumeSha256: createHash("sha256").update(readFileSync(checkpoint)).digest("hex"),
        checkpointScopeSha256: "f".repeat(64),
      },
    );
    expect(tail.status, tail.error).toBe("ok");
    const baseline = parseSamples(readFileSync(fullPath, "utf8"));
    const first = parseSamples(readFileSync(partialPath, "utf8"));
    const continued = parseSamples(readFileSync(tailPath, "utf8"));
    for (const leaf of [...baseline.variables, ...baseline.sampleStats.keys()]) {
      const expected = Array.from(chainView(baseline, leaf, 0));
      expect(Array.from(chainView(first, leaf, 0))).toEqual(expected.slice(0, 4));
      expect(Array.from(chainView(continued, leaf, 0))).toEqual(expected.slice(4));
    }
  }, 900_000);

  it("replays one threaded NUTS chain from its original seed", async () => {
    const env = ENV as NonNullable<typeof ENV>;
    const model = join(dir, "selected-bugs.jl");
    writeFileSync(model, BUGS_MODEL);
    const configured: ResolvedSpec = {
      ...spec(6, 2),
      backend: { id: "juliabugs", runtime: "julia", version: DEFAULT_JULIA_CHANNEL },
      model: { kind: "file", path: model, entry: "build_model" },
      modelPath: model,
      data: { N: TABLE_DATA.y.length, ...TABLE_DATA },
    };
    configured.sampler.warmup = 10;
    configured.sampler.parallel = "threads";
    const invocation = { command: env.command, args: env.args };
    const fullPath = join(dir, "selected-bugs-full.json");
    const full = await runFit(configured, invocation, {
      spawn: createFitRunner(),
      projectDir: env.projectDir,
      outPath: fullPath,
    });
    expect(full.status, full.error).toBe("ok");

    const selectedPath = join(dir, "selected-bugs-chain.json");
    const batches: DrawBatch[] = [];
    const selected = await runFit(
      { ...configured, sampler: { ...configured.sampler, chains: 1, parallel: "serial" } },
      invocation,
      {
        spawn: createFitRunner(),
        projectDir: env.projectDir,
        outPath: selectedPath,
        checkpointDir: join(dir, "selected-bugs-checkpoints"),
        checkpointScopeSha256: "e".repeat(64),
        chainSelection: { index: 1, count: 2 },
        onDraws: (batch) => batches.push(batch),
      },
    );
    expect(selected.status, selected.error).toBe("ok");
    expect(batches.map(({ chain, seq, iteration }) => [chain, seq, iteration])).toEqual([
      [1, 0, 6],
    ]);
    const baseline = parseSamples(readFileSync(fullPath, "utf8"));
    const replayed = parseSamples(readFileSync(selectedPath, "utf8"));
    for (const leaf of [...baseline.variables, ...baseline.sampleStats.keys()]) {
      expect(Array.from(chainView(replayed, leaf, 0))).toEqual(
        Array.from(chainView(baseline, leaf, 1)),
      );
    }
  }, 900_000);

  it("continues threaded NUTS chains from verified checkpoints", async () => {
    const env = ENV as NonNullable<typeof ENV>;
    const model = join(dir, "checkpoint-bugs.jl");
    writeFileSync(model, BUGS_MODEL);
    const configured: ResolvedSpec = {
      ...spec(12, 2),
      backend: { id: "juliabugs", runtime: "julia", version: DEFAULT_JULIA_CHANNEL },
      model: { kind: "file", path: model, entry: "build_model" },
      modelPath: model,
      data: { N: TABLE_DATA.y.length, ...TABLE_DATA },
    };
    configured.sampler.warmup = 10;
    configured.sampler.parallel = "threads";
    const invocation = { command: env.command, args: env.args };
    const fullPath = join(dir, "checkpoint-bugs-full.json");
    const full = await runFit(configured, invocation, {
      spawn: createFitRunner(),
      projectDir: env.projectDir,
      outPath: fullPath,
    });
    expect(full.status, full.error).toBe("ok");

    const partialPath = join(dir, "checkpoint-bugs-partial.json");
    const checkpointDir = join(dir, "checkpoint-bugs");
    const scope = "d".repeat(64);
    const batches: DrawBatch[] = [];
    const partial = await runFit(
      { ...configured, sampler: { ...configured.sampler, draws: 8 } },
      invocation,
      {
        spawn: createFitRunner(),
        projectDir: env.projectDir,
        outPath: partialPath,
        checkpointDir,
        checkpointScopeSha256: scope,
        drawBatchSize: 4,
        onDraws: (batch) => batches.push(batch),
      },
    );
    expect(partial.status, partial.error).toBe("ok");
    expect(batches).toHaveLength(4);

    const baseline = parseSamples(readFileSync(fullPath, "utf8"));
    const first = parseSamples(readFileSync(partialPath, "utf8"));
    for (const chain of [0, 1]) {
      const checkpoint = join(checkpointDir, `chain-${chain}-iteration-8.bin`);
      const last = batches.find((batch) => batch.chain === chain && batch.iteration === 8);
      expect(last?.checkpoint?.sha256).toBe(
        createHash("sha256").update(readFileSync(checkpoint)).digest("hex"),
      );
      const tailPath = join(dir, `checkpoint-bugs-tail-${chain}.json`);
      const tailBatches: DrawBatch[] = [];
      const tail = await runFit(
        { ...configured, sampler: { ...configured.sampler, chains: 1, draws: 4 } },
        invocation,
        {
          spawn: createFitRunner(),
          projectDir: env.projectDir,
          outPath: tailPath,
          resumeFrom: checkpoint,
          resumeSha256: last?.checkpoint?.sha256,
          checkpointDir: join(dir, `checkpoint-bugs-resumed-${chain}`),
          checkpointScopeSha256: scope,
          drawBatchSize: 4,
          onDraws: (batch) => tailBatches.push(batch),
        },
      );
      expect(tail.status, tail.error).toBe("ok");
      expect(tailBatches.map(({ chain: id, seq, iteration }) => [id, seq, iteration])).toEqual([
        [chain, 2, 12],
      ]);
      const continued = parseSamples(readFileSync(tailPath, "utf8"));
      for (const leaf of [...baseline.variables, ...baseline.sampleStats.keys()]) {
        const expected = Array.from(chainView(baseline, leaf, chain));
        expect(Array.from(chainView(first, leaf, chain))).toEqual(expected.slice(0, 8));
        expect(Array.from(chainView(continued, leaf, 0))).toEqual(expected.slice(8));
      }
    }
  }, 900_000);

  it("streams threaded JuliaBUGS draws from both chains", async () => {
    const env = ENV as NonNullable<typeof ENV>;
    const model = join(dir, "threaded-bugs.jl");
    writeFileSync(model, BUGS_MODEL);
    const configured: ResolvedSpec = {
      ...spec(60, 2),
      backend: { id: "juliabugs", runtime: "julia", version: DEFAULT_JULIA_CHANNEL },
      model: { kind: "file", path: model, entry: "build_model" },
      modelPath: model,
      data: { N: TABLE_DATA.y.length, ...TABLE_DATA },
    };
    configured.sampler.warmup = 60;
    configured.sampler.parallel = "threads";
    const outPath = join(dir, "threaded-bugs.samples.json");
    const batches: DrawBatch[] = [];
    const progress: FitProgress[] = [];
    const result = await runFit(
      configured,
      { command: env.command, args: env.args },
      {
        spawn: createFitRunner(),
        projectDir: env.projectDir,
        outPath,
        onDraws: (b) => batches.push(b),
        onProgress: (p) => progress.push(p),
      },
    );
    expect(result.status, result.error).toBe("ok");
    const samples = parseSamples(readFileSync(outPath, "utf8"));
    expect([...new Set(batches.map((b) => b.chain))].sort((a, b) => a - b)).toEqual([0, 1]);
    expect([...new Set(progress.map((p) => p.chain))].sort((a, b) => a - b)).toEqual([1, 2]);
    for (const chain of [0, 1]) {
      const seqs = batches.filter((b) => b.chain === chain).map((b) => b.seq);
      expect(seqs).toEqual(seqs.map((_, i) => i));
      const columns = reconstructChain(batches, chain);
      for (const leaf of [...samples.variables, ...samples.sampleStats.keys()]) {
        expect(columns[leaf]).toEqual(Array.from(chainView(samples, leaf, chain)));
      }
    }
  }, 600_000);

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
  it("rejects unnamed observations instead of exporting an incomplete observed set", async () => {
    const env = ENV as NonNullable<typeof ENV>;
    const modelFile = join(dir, "observed_literal.jl");
    writeFileSync(
      modelFile,
      `using Turing
@model function build_model(data)
    mu ~ Normal()
    y = data["y"]
    y ~ Normal(mu)
    0.0 ~ Normal(mu)
end
`,
    );
    const samplesPath = join(dir, "observed_literal.post.json");
    writeFileSync(
      samplesPath,
      JSON.stringify({
        size: [1, 1, 1],
        value_flat: [0.5],
        parameters: ["mu"],
        name_map: { parameters: ["mu"], internals: [] },
      }),
    );
    const literalSpec: ResolvedSpec = {
      ...spec(1, 1),
      model: { kind: "file", path: modelFile, entry: "build_model" },
      modelPath: modelFile,
      data: { y: 1.5 },
    };
    const result = await runObserved(
      literalSpec,
      { command: env.command, args: env.args },
      {
        spawn: createFitRunner(),
        projectDir: env.projectDir,
        outPath: join(dir, "observed_literal.json"),
        samplesPath,
      },
    );
    expect(result.status).toBe("error");
    expect(result.status === "error" ? result.error : "").toMatch(
      /observed site has no variable name/,
    );
  }, 300_000);

  it("records vector and scalar observed sites by their model term names", async () => {
    const env = ENV as NonNullable<typeof ENV>;
    const vectorModelPath = join(dir, "observed_vector.jl");
    writeFileSync(
      vectorModelPath,
      `using Turing
using LinearAlgebra
@model function build_model(data)
    mu ~ Normal()
    y = data["y"]
    y ~ MvNormal(fill(mu, length(y)), I)
end
`,
    );
    const samplesPath = join(dir, "observed.post.json");
    writeFileSync(
      samplesPath,
      JSON.stringify({
        size: [2, 1, 1],
        value_flat: [0.25, -0.5],
        parameters: ["mu"],
        name_map: { parameters: ["mu"], internals: [] },
      }),
    );
    const vectorSpec: ResolvedSpec = {
      ...spec(2, 1),
      model: { kind: "file", path: vectorModelPath, entry: "build_model" },
      modelPath: vectorModelPath,
      data: { y: [1.5, 2.5] },
    };
    const vectorPath = join(dir, "observed.vector.json");
    const vector = await runObserved(
      vectorSpec,
      { command: env.command, args: env.args },
      {
        spawn: createFitRunner(),
        projectDir: env.projectDir,
        outPath: vectorPath,
        samplesPath,
      },
    );
    expect(vector.status, vector.status === "error" ? vector.error : "").toBe("ok");
    expect(parseObservedData(readFileSync(vectorPath, "utf8")).terms).toEqual([
      { name: "y", value: [1.5, 2.5] },
    ]);

    const loopModelPath = join(dir, "observed_loop.jl");
    writeFileSync(
      loopModelPath,
      `using Turing
@model function build_model(data)
    mu ~ Normal()
    y = data["y"]
    for i in eachindex(y)
        y[i] ~ Normal(mu)
    end
end
`,
    );
    const loopSpec: ResolvedSpec = {
      ...vectorSpec,
      model: { kind: "file", path: loopModelPath, entry: "build_model" },
      modelPath: loopModelPath,
    };
    const loopPath = join(dir, "observed.loop.json");
    const loop = await runObserved(
      loopSpec,
      { command: env.command, args: env.args },
      {
        spawn: createFitRunner(),
        projectDir: env.projectDir,
        outPath: loopPath,
        samplesPath,
      },
    );
    expect(loop.status, loop.status === "error" ? loop.error : "").toBe("ok");
    expect(parseObservedData(readFileSync(loopPath, "utf8")).terms).toEqual([
      { name: "y[1]", value: 1.5 },
      { name: "y[2]", value: 2.5 },
    ]);
  }, 300_000);

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

    const observedPath = join(dir, "bugs.observed.json");
    const observed = await runObserved(
      bugsSpec,
      { command: env.command, args: env.args },
      {
        spawn: createFitRunner(),
        projectDir: env.projectDir,
        outPath: observedPath,
        samplesPath: postPath,
      },
    );
    expect(observed.status, observed.status === "error" ? observed.error : "").toBe("ok");
    expect(parseObservedData(readFileSync(observedPath, "utf8")).terms).toEqual(
      TABLE_DATA.y.map((value, i) => ({ name: `y[${i + 1}]`, value })),
    );

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
// propose it instead. The component priors are tight (precision 4, so sd 0.5) and
// far apart, which makes the label assignment identifiable: the mirrored solution
// costs ~140 log units of prior, so no chain can settle in it and every sampler
// here must agree on which component each observation belongs to.
const MIXTURE_MODEL = `import JuliaBUGS

const model_def = JuliaBUGS.@bugs begin
    mu[1] ~ dnorm(-3, 4)
    mu[2] ~ dnorm(3, 4)
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
    draws: 300,
    warmup: 500,
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

  it("caps JuliaBUGS NUTS tree depth in a real fit", async () => {
    const { result, outPath } = await fitMixture(
      "bugs_depth",
      nuts({ draws: 30, warmup: 30, chains: 1, max_depth: 1 }),
      "marginalized",
    );
    expect(result.status).toBe("ok");
    const samples = parseSamples(readFileSync(outPath, "utf8"));
    const depths = samples.sampleStats.get("tree_depth");
    expect(depths).toBeDefined();
    expect([...(depths ?? [])].every((depth) => depth <= 1)).toBe(true);
  }, 300_000);

  it("restores marginalized JuliaBUGS NUTS draws and discrete latents", async () => {
    const env = ENV as NonNullable<typeof ENV>;
    const invocation = { command: env.command, args: env.args };
    const configured = mixtureSpec(nuts({ draws: 8, warmup: 20, chains: 1 }), "marginalized");
    const fullPath = join(dir, "marginalized-checkpoint-full.json");
    const full = await runFit(configured, invocation, {
      spawn: createFitRunner(),
      projectDir: env.projectDir,
      outPath: fullPath,
    });
    expect(full.status, full.error).toBe("ok");

    const partialPath = join(dir, "marginalized-checkpoint-partial.json");
    const checkpointDir = join(dir, "marginalized-checkpoints");
    const scope = "9".repeat(64);
    const partial = await runFit(
      { ...configured, sampler: { ...configured.sampler, draws: 4 } },
      invocation,
      {
        spawn: createFitRunner(),
        projectDir: env.projectDir,
        outPath: partialPath,
        checkpointDir,
        checkpointScopeSha256: scope,
        drawBatchSize: 4,
      },
    );
    expect(partial.status, partial.error).toBe("ok");

    const checkpoint = join(checkpointDir, "chain-0-iteration-4.bin");
    const tailPath = join(dir, "marginalized-checkpoint-tail.json");
    const tail = await runFit(
      { ...configured, sampler: { ...configured.sampler, draws: 4 } },
      invocation,
      {
        spawn: createFitRunner(),
        projectDir: env.projectDir,
        outPath: tailPath,
        resumeFrom: checkpoint,
        resumeSha256: createHash("sha256").update(readFileSync(checkpoint)).digest("hex"),
        checkpointScopeSha256: scope,
      },
    );
    expect(tail.status, tail.error).toBe("ok");

    const baseline = parseSamples(readFileSync(fullPath, "utf8"));
    const first = parseSamples(readFileSync(partialPath, "utf8"));
    const continued = parseSamples(readFileSync(tailPath, "utf8"));
    expect(baseline.variables).toContain("z[1]");
    for (const leaf of [...baseline.variables, ...baseline.sampleStats.keys()]) {
      const expected = Array.from(chainView(baseline, leaf, 0));
      expect(Array.from(chainView(first, leaf, 0))).toEqual(expected.slice(0, 4));
      expect(Array.from(chainView(continued, leaf, 0))).toEqual(expected.slice(4));
    }
  }, 900_000);

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

  it("fits a bare .bugs program, marginalizing its discrete latents unasked", async () => {
    const bugsPath = join(dir, "mixture.bugs");
    writeFileSync(
      bugsPath,
      [
        "model {",
        "  mu[1] ~ dnorm(-3, 4)",
        "  mu[2] ~ dnorm(3, 4)",
        "  for (i in 1:N) {",
        "    z[i] ~ dcat(w[1:2])",
        "    y[i] ~ dnorm(mu[z[i]], 1)",
        "  }",
        "}",
        "",
      ].join("\n"),
    );
    const env = ENV as NonNullable<typeof ENV>;
    const outPath = join(dir, "mix_bugs.samples.json");
    const base = mixtureSpec(nuts());
    // `y` is observed, so its starting value is ignored rather than refused.
    const withInits = {
      ...base,
      model: { kind: "file" as const, path: bugsPath, entry: "build_model" },
      modelPath: bugsPath,
      sampler: { ...base.sampler, initial_params: { mu: [-3, 3], y: MIXTURE_DATA.y } },
    };
    const result = await runFit(
      withInits,
      { command: env.command, args: env.args },
      {
        spawn: createFitRunner(),
        projectDir: env.projectDir,
        outPath,
        recordPath: join(dir, "mix_bugs.run.json"),
      },
    );
    expect(result.status).toBe("ok");

    const samples: Samples = parseSamples(readFileSync(outPath, "utf8"));
    for (const leaf of ["mu[1]", "mu[2]", "z[1]", "z[10]"]) {
      expect(samples.variables).toContain(leaf);
    }
    expect(pooledMean(samples, "mu[1]")).toBeCloseTo(-3.0, 0);
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

  it("samples the marginalized model with no gradient at all, through Slice", async () => {
    const { result, outPath } = await fitMixture(
      "mix_slice",
      { ...nuts(), algorithm: "Slice", slice_width: 1.0 },
      "marginalized",
    );
    expect(result.status).toBe("ok");

    const samples: Samples = parseSamples(readFileSync(outPath, "utf8"));
    expect(pooledMean(samples, "mu[1]")).toBeCloseTo(-3.0, 0);
    expect(pooledMean(samples, "mu[2]")).toBeCloseTo(3.0, 0);
    expect(pooledMean(samples, "z[1]")).toBe(1);
    // The slice sampler counts proposals per coordinate, so the statistic arrives
    // as an array and reaches the samples file split into scalar columns.
    expect([...samples.sampleStats.keys()]).toContain("num_proposals[1]");
  }, 900_000);

  it("gives the continuous block a gradient-free Slice update inside Gibbs", async () => {
    const { result, outPath } = await fitMixture("mix_gibbs_slice", {
      ...nuts(),
      algorithm: "Gibbs",
      blocks: [
        { variables: ["mu"], algorithm: "Slice", slice_width: 1.0, adapt_delta: 0.8 },
        { variables: ["z"], algorithm: "MH", adapt_delta: 0.8 },
      ],
    });
    expect(result.status).toBe("ok");

    const samples: Samples = parseSamples(readFileSync(outPath, "utf8"));
    expect(pooledMean(samples, "mu[1]")).toBeCloseTo(-3.0, 0);
    expect(pooledMean(samples, "mu[2]")).toBeCloseTo(3.0, 0);
    // One block over all ten states proposes them jointly, from the prior, so it
    // accepts a change of assignment rarely; what this checks is that both block
    // components ran and the states came back as states. Single-site updates are
    // what `algorithm = "MH"` gives.
    for (let chain = 0; chain < samples.nChains; chain++) {
      for (const value of chainView(samples, "z[1]", chain)) {
        expect([1, 2]).toContain(value);
      }
    }
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

// An unbounded count, the model MH exists for: marginalization can only sum out a
// finite support. A Gaussian proposal cannot represent an integer, so this also
// covers the kernel choice, which reads the node's support rather than the value
// JuliaBUGS happens to store it in.
const POISSON_MODEL = `import JuliaBUGS

const model_def = JuliaBUGS.@bugs begin
    p ~ dbeta(2, 2)
    lambda ~ dgamma(2, 0.2)
    for i in 1:N
        n[i] ~ dpois(lambda)
        y[i] ~ dbin(p, n[i])
    end
end

build_model(data) = JuliaBUGS.compile(model_def, data)
`;

const POISSON_DATA = { N: 8, y: [4, 6, 5, 7, 3, 5, 6, 4] };

d("julia e2e: juliabugs unbounded discrete latents through MH", () => {
  it("moves an integer count instead of proposing off the lattice", async () => {
    const env = ENV as NonNullable<typeof ENV>;
    const modelFile = join(dir, "poisson_bugs.jl");
    writeFileSync(modelFile, POISSON_MODEL);
    const outPath = join(dir, "poisson.samples.json");
    const result = await runFit(
      {
        ...spec(300, 2),
        backend: { id: "juliabugs", runtime: "julia", version: DEFAULT_JULIA_CHANNEL },
        model: { kind: "file", path: modelFile, entry: "build_model" },
        modelPath: modelFile,
        sampler: {
          algorithm: "MH",
          draws: 300,
          warmup: 300,
          chains: 2,
          adapt_delta: 0.8,
          thin: 1,
          parallel: "serial",
          // The compiled defaults put every count at zero, which the observed
          // successes forbid, and an environment-based sampler cannot leave it.
          initial_params: { lambda: 6, p: 0.7, n: [6, 9, 8, 10, 5, 8, 9, 6] },
        },
        data: POISSON_DATA,
      },
      { command: env.command, args: env.args },
      {
        spawn: createFitRunner(),
        projectDir: env.projectDir,
        outPath,
        recordPath: join(dir, "poisson.run.json"),
      },
    );

    expect(result.status).toBe("ok");
    const samples: Samples = parseSamples(readFileSync(outPath, "utf8"));
    for (let chain = 0; chain < samples.nChains; chain++) {
      for (const value of chainView(samples, "n[1]", chain)) {
        expect(Number.isInteger(value)).toBe(true);
        // A count below its own observed successes has zero probability.
        expect(value).toBeGreaterThanOrEqual(POISSON_DATA.y[0] as number);
      }
    }
    // A kernel that cannot land on the lattice would leave the count where it
    // started, so the run has to show it moving.
    const counts = new Set(Array.from(chainView(samples, "n[1]", 0)));
    expect(counts.size).toBeGreaterThan(1);
    expect(pooledMean(samples, "lambda")).toBeGreaterThan(5);
  }, 900_000);
});

// A partly observed count: the given entries condition the fit, the unobserved
// ones are latent nodes with an observed child, so their conditional is informed
// by the data rather than by the prior alone.
const PARTLY_OBSERVED_DATA = {
  N: 8,
  y: [4, 6, 5, 7, 3, 5, 6, 4],
  n: [7, 9, 8, 10, null, null, null, null],
};

d("julia e2e: juliabugs partly observed data", () => {
  it("samples the unobserved counts and conditions on the given ones", async () => {
    const env = ENV as NonNullable<typeof ENV>;
    const modelFile = join(dir, "partly_bugs.jl");
    writeFileSync(modelFile, POISSON_MODEL);
    const outPath = join(dir, "partly.samples.json");
    const result = await runFit(
      {
        ...spec(300, 2),
        backend: { id: "juliabugs", runtime: "julia", version: DEFAULT_JULIA_CHANNEL },
        model: { kind: "file", path: modelFile, entry: "build_model" },
        modelPath: modelFile,
        sampler: {
          algorithm: "MH",
          draws: 300,
          warmup: 300,
          chains: 2,
          adapt_delta: 0.8,
          thin: 1,
          parallel: "serial",
          // Named for the whole array; the given entries keep their own values.
          initial_params: { lambda: 8, p: 0.7, n: [7, 9, 8, 10, 8, 9, 10, 8] },
        },
        data: PARTLY_OBSERVED_DATA,
      },
      { command: env.command, args: env.args },
      {
        spawn: createFitRunner(),
        projectDir: env.projectDir,
        outPath,
        recordPath: join(dir, "partly.run.json"),
      },
    );

    expect(result.status).toBe("ok");
    const samples: Samples = parseSamples(readFileSync(outPath, "utf8"));
    // An observed entry is data, so it is not a parameter of the fit.
    expect(samples.variables).not.toContain("n[1]");
    expect(samples.variables).toContain("n[5]");

    for (let chain = 0; chain < samples.nChains; chain++) {
      for (const value of chainView(samples, "n[5]", chain)) {
        expect(Number.isInteger(value)).toBe(true);
        // A count below its own observed successes has zero probability.
        expect(value).toBeGreaterThanOrEqual(PARTLY_OBSERVED_DATA.y[4] as number);
      }
    }
    expect(new Set(Array.from(chainView(samples, "n[5]", 0))).size).toBeGreaterThan(1);
    // The given counts average 8.5, which the rate has to follow.
    expect(pooledMean(samples, "lambda")).toBeGreaterThan(5);
  }, 900_000);
});

// A partly observed continuous outcome with no children: each unobserved entry
// is imputed from its own conditional, which is the sampling distribution.
const PARTLY_NORMAL_MODEL = `import JuliaBUGS

const model_def = JuliaBUGS.@bugs begin
    mu ~ dnorm(0, 0.001)
    tau ~ dgamma(0.01, 0.01)
    for i in 1:N
        y[i] ~ dnorm(mu, tau)
    end
end

build_model(data) = JuliaBUGS.compile(model_def, data; adtype = JuliaBUGS.ADTypes.AutoForwardDiff())
`;

const PARTLY_NORMAL_DATA = {
  N: 10,
  y: [9.8, 10.4, 9.6, 10.1, null, 10.3, 9.9, null, 10.2, 9.7],
};

d("julia e2e: juliabugs imputes a partly observed continuous outcome", () => {
  it("returns the unobserved entries as draws centred on the fitted mean", async () => {
    const env = ENV as NonNullable<typeof ENV>;
    const modelFile = join(dir, "partly_normal.jl");
    writeFileSync(modelFile, PARTLY_NORMAL_MODEL);
    const outPath = join(dir, "partly_normal.samples.json");
    const result = await runFit(
      {
        ...spec(500, 2),
        backend: { id: "juliabugs", runtime: "julia", version: DEFAULT_JULIA_CHANNEL },
        model: { kind: "file", path: modelFile, entry: "build_model" },
        modelPath: modelFile,
        sampler: {
          algorithm: "NUTS",
          draws: 500,
          warmup: 500,
          chains: 2,
          adapt_delta: 0.8,
          thin: 1,
          parallel: "serial",
        },
        data: PARTLY_NORMAL_DATA,
      },
      { command: env.command, args: env.args },
      {
        spawn: createFitRunner(),
        projectDir: env.projectDir,
        outPath,
        recordPath: join(dir, "partly_normal.run.json"),
      },
    );

    expect(result.status).toBe("ok");
    const samples: Samples = parseSamples(readFileSync(outPath, "utf8"));
    expect(samples.variables).not.toContain("y[1]");
    expect(samples.variables).toContain("y[5]");
    expect(samples.variables).toContain("y[8]");

    // The observed entries average 10.0, and an imputed entry follows the mean.
    expect(pooledMean(samples, "mu")).toBeCloseTo(10.0, 0);
    expect(pooledMean(samples, "y[5]")).toBeCloseTo(10.0, 0);
    // An imputation is a draw, not a point estimate, so it has to vary.
    expect(new Set(Array.from(chainView(samples, "y[5]", 0))).size).toBeGreaterThan(1);
  }, 900_000);
});
