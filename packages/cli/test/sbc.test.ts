import { parseSamples, type Samples } from "@mcmcjs/core";
import { describe, expect, it } from "vitest";
import {
  buildSbcReport,
  formatSbcHuman,
  ranksFor,
  simulatedDataFor,
  targetLeaves,
} from "../src/sbc";

/** A samples wire with explicit per-parameter, per-chain, per-draw values. */
function samplesOf(perVar: Record<string, number[][]>): Samples {
  const parameters = Object.keys(perVar);
  const chains = (perVar[parameters[0] as string] as number[][]).length;
  const draws = (perVar[parameters[0] as string] as number[][])[0]?.length as number;
  const total = parameters.length;
  const flat: number[] = new Array(draws * total * chains);
  parameters.forEach((v, p) => {
    (perVar[v] as number[][]).forEach((chain, c) => {
      chain.forEach((value, i) => {
        flat[i + p * draws + c * draws * total] = value;
      });
    });
  });
  return parseSamples(
    JSON.stringify({
      size: [draws, total, chains],
      value_flat: flat,
      parameters,
      name_map: { parameters, internals: [] },
    }),
  );
}

describe("targetLeaves", () => {
  it("orders vector leaves by index and accepts a scalar", () => {
    expect(targetLeaves(["y[2]", "y[10]", "y[1]"], "y")).toEqual(["y[1]", "y[2]", "y[10]"]);
    expect(targetLeaves(["y"], "y")).toEqual(["y"]);
  });

  it("rejects multi-dimensional and missing targets", () => {
    expect(() => targetLeaves(["y[1,2]"], "y")).toThrow(/multi-dimensional/);
    expect(() => targetLeaves(["z[1]"], "y")).toThrow(/no predictive draws/);
  });
});

describe("simulatedDataFor", () => {
  const predictive = samplesOf({
    "y[1]": [[10, 20, 30]],
    "y[2]": [[11, 21, 31]],
    "y[3]": [[12, 22, 32]],
  });

  it("replaces the target with the ith predictive row, keeping other keys", () => {
    const data = simulatedDataFor({ y: [0, 0, 0], x: [1, 2, 3], N: 3 }, ["y"], predictive, 1);
    expect(data.y).toEqual([20, 21, 22]);
    expect(data.x).toEqual([1, 2, 3]);
    expect(data.N).toBe(3);
  });

  it("keeps a scalar target scalar", () => {
    const scalar = samplesOf({ y: [[7, 8]] });
    expect(simulatedDataFor({ y: 0 }, ["y"], scalar, 1).y).toBe(8);
  });
});

describe("ranksFor", () => {
  it("counts thinned posterior draws below the prior value", () => {
    const prior = samplesOf({ mu: [[0.35, 5]], nuisance: [[0, 0]] });
    // Posterior draws for mu: 0.0 .. 0.9 across two chains of five.
    const posterior = samplesOf({
      mu: [
        [0.0, 0.1, 0.2, 0.3, 0.4],
        [0.5, 0.6, 0.7, 0.8, 0.9],
      ],
    });
    const ranks = ranksFor(prior, posterior, 0, 10);
    expect(ranks.get("mu")).toEqual({ rank: 4, nPossible: 11 });
    // A prior value above every draw ranks at the maximum.
    expect(ranksFor(prior, posterior, 1, 10).get("mu")).toEqual({ rank: 10, nPossible: 11 });
    // Parameters absent from the posterior are skipped, not errors.
    expect(ranks.has("nuisance")).toBe(false);
  });

  it("thins evenly when the posterior is larger than rankDraws", () => {
    const prior = samplesOf({ mu: [[0.5]] });
    const draws = Array.from({ length: 100 }, (_, i) => i / 100);
    const posterior = samplesOf({ mu: [draws] });
    const { rank, nPossible } = ranksFor(prior, posterior, 0, 10).get("mu") as {
      rank: number;
      nPossible: number;
    };
    expect(nPossible).toBe(11);
    // Thinned draws are 0.0, 0.1, ..., 0.9; five sit below 0.5.
    expect(rank).toBe(5);
  });
});

describe("buildSbcReport", () => {
  it("passes uniform ranks and fails concentrated ones", () => {
    const uniform = Array.from({ length: 60 }, (_, i) => i % 11);
    const stuck = new Array<number>(60).fill(0);
    const report = buildSbcReport(
      new Map([
        ["mu", uniform],
        ["sigma", stuck],
      ]),
      11,
      { rankDraws: 10, simulations: 60 },
    );
    expect(report.calibrated).toBe(false);
    const mu = report.parameters.find((p) => p.name === "mu");
    const sigma = report.parameters.find((p) => p.name === "sigma");
    expect(mu?.pValue).toBeGreaterThan(0.05);
    expect(sigma?.pValue).toBeLessThan(1e-10);

    const good = buildSbcReport(new Map([["mu", uniform]]), 11, {
      rankDraws: 10,
      simulations: 60,
    });
    expect(good.calibrated).toBe(true);
  });

  it("formats a readable table with a verdict", () => {
    const report = buildSbcReport(
      new Map([["mu", Array.from({ length: 40 }, (_, i) => i % 11)]]),
      11,
      { rankDraws: 10, simulations: 40 },
    );
    const text = formatSbcHuman(report);
    expect(text).toContain("40 simulations");
    expect(text).toContain("mu");
    expect(text).toContain("calibrated");
  });
});

// A real end-to-end calibration run against Julia; opt-in like the julia e2e
// suite (MCMC_E2E=1 with the pinned env provisioned).
describe.skipIf(process.env.MCMC_E2E !== "1")("sbc e2e", () => {
  it("reports a well-specified model as calibrated", async () => {
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const { mkdtempSync, writeFileSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join, resolve } = await import("node:path");

    const dir = mkdtempSync(join(tmpdir(), "sbc-e2e-"));
    writeFileSync(
      join(dir, "model.jl"),
      `using Turing

@model function build_model(data)
    y = data["y"]
    mu ~ Normal(0, 2)
    for i in eachindex(y)
        y[i] ~ Normal(mu, 1)
    end
end
`,
    );
    writeFileSync(
      join(dir, "spec.toml"),
      [
        'schema_version = "0"',
        "seed = 11",
        "[backend]",
        'id = "turing"',
        "[model]",
        'kind = "file"',
        'path = "./model.jl"',
        "[sampler]",
        "draws = 150",
        "warmup = 100",
        "chains = 1",
        "[data]",
        "y = [0.5, -0.2, 0.8, 0.1]",
        "[predict]",
        'targets = ["y"]',
      ].join("\n"),
    );

    const cli = resolve(__dirname, "..", "dist", "index.js");
    const { stdout } = await promisify(execFile)(
      process.execPath,
      [cli, "sbc", join(dir, "spec.toml"), "--simulations", "6", "--json"],
      { timeout: 850_000 },
    );
    const report = JSON.parse(stdout) as {
      simulations: number;
      calibrated: boolean;
      parameters: { name: string; ranks: number[] }[];
    };
    expect(report.simulations).toBe(6);
    expect(report.parameters.map((p) => p.name)).toContain("mu");
    for (const p of report.parameters) {
      expect(p.ranks).toHaveLength(6);
      for (const r of p.ranks) {
        expect(r).toBeGreaterThanOrEqual(0);
        expect(r).toBeLessThanOrEqual(100);
      }
    }
    // Six simulations only catch gross breakage; a correct model must pass.
    expect(report.calibrated).toBe(true);
  }, 900_000);
});
