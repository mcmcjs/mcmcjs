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
  const juliaup = await detectJuliaup();
  if (!juliaup.found || !juliaup.path) return null;
  try {
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
    expect(batches.length).toBeGreaterThan(0);

    const chains = [...new Set(batches.map((b) => b.chain))].sort((a, c) => a - c);
    expect(chains).toEqual([0, 1]);

    for (const chain of chains) {
      const cols = reconstructChain(batches, chain);
      // Every leaf the run reported appears in the stream and matches exactly.
      for (const leaf of samples.variables) {
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
    const onDraws = () => controller.abort();
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

    expect(result.status).toBe("cancelled");
  }, 300_000);
});
