// Numerical parity of the generated marginalized Stan code against a pure-TS
// brute-force reference and (when JULIABUGS_PROJECT is set) JuliaBUGS's
// runtime auto-marginalization. Opt-in: DOODLEPPL_PARITY=1, needs CmdStan.
// Values are compared as differences between points so that the constants
// dropped by Stan `~` statements cancel; gradients are compared directly.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import {
  extractPartialDiscreteFields,
  generateStanDataJson,
  generateStanModel,
} from "../src/codegen/stan";
import { compileModel, type LogProbResult, logProb, sample } from "./helpers/cmdstan";
import {
  binMixData,
  binMixElements,
  binMixPoints,
  chainDagData,
  chainDagElements,
  chainDagPoints,
  mixedDagData,
  mixedDagElements,
  mixedDagPoints,
  mixtureData,
  mixtureDetElements,
  mixtureElements,
  mixturePartialData,
  mixturePartialElements,
  mixturePoints,
} from "./helpers/marginalization-fixtures";
import {
  binMixLogDensity,
  binMixZPosterior,
  chainDagJointPosterior,
  chainDagLogDensity,
  mixedDagJointPosterior,
  mixedDagLogDensity,
  mixtureLogDensity,
  mixturePartialLogDensity,
  mixtureZPosterior,
} from "./helpers/reference-math";

const PARITY = process.env.DOODLEPPL_PARITY === "1";
const JULIA_PROJECT = process.env.JULIABUGS_PROJECT;
const HELPERS = fileURLToPath(new URL("./helpers", import.meta.url));

interface JuliaRef {
  logdensity: number;
  gradient: Record<string, number>;
}

function juliaReference(
  model: string,
  data: Record<string, unknown>,
  points: Record<string, unknown>[],
  transforms: Record<string, string> = {},
): JuliaRef[] {
  const dir = mkdtempSync(join(tmpdir(), "doodleppl-julia-"));
  const specFile = join(dir, "spec.json");
  const outFile = join(dir, "out.json");
  writeFileSync(specFile, JSON.stringify({ model, data, points, transforms }));
  execFileSync(
    "julia",
    [`--project=${JULIA_PROJECT}`, join(HELPERS, "juliabugs_ref.jl"), specFile, outFile],
    { stdio: "pipe", timeout: 600_000 },
  );
  return JSON.parse(readFileSync(outFile, "utf8"));
}

function pairwiseDiffs(values: number[]): number[] {
  return values.slice(1).map((v) => v - (values[0] as number));
}

describe.runIf(PARITY)("generated Stan matches the brute-force reference", () => {
  let mixtureBin: string;
  let mixtureDetBin: string;
  let dagBin: string;
  let chainBin: string;
  let binMixBin: string;
  let partialBin: string;
  let partialData: Record<string, unknown>;
  let mixtureLp: LogProbResult[];
  let partialLp: LogProbResult[];
  let dagLp: LogProbResult[];
  let chainLp: LogProbResult[];
  let binMixLp: LogProbResult[];

  beforeAll(() => {
    mixtureBin = compileModel("mixture", generateStanModel(mixtureElements()));
    mixtureDetBin = compileModel("mixture_det", generateStanModel(mixtureDetElements()));
    dagBin = compileModel("mixeddag", generateStanModel(mixedDagElements()));
    chainBin = compileModel("chaindag", generateStanModel(chainDagElements()));
    binMixBin = compileModel("binmix", generateStanModel(binMixElements()));
    partialBin = compileModel(
      "mixturepartial",
      generateStanModel(mixturePartialElements(), mixturePartialData),
    );
    partialData = JSON.parse(
      generateStanDataJson(
        mixturePartialData,
        [],
        extractPartialDiscreteFields(mixturePartialElements(), mixturePartialData),
      ),
    );
    mixtureLp = mixturePoints.map((p) => logProb(mixtureBin, mixtureData, p));
    dagLp = mixedDagPoints.map((p) => logProb(dagBin, mixedDagData, p));
    chainLp = chainDagPoints.map((p) => logProb(chainBin, chainDagData, p));
    binMixLp = binMixPoints.map((p) => logProb(binMixBin, binMixData, p));
    partialLp = mixturePoints.map((p) => logProb(partialBin, partialData, p));
  }, 600_000);

  it("mixture log density differences match to double precision", () => {
    const stan = pairwiseDiffs(mixtureLp.map((r) => r.lp));
    const ref = pairwiseDiffs(mixturePoints.map((p) => mixtureLogDensity(mixtureData, p)));
    stan.forEach((d, i) => {
      expect(d).toBeCloseTo(ref[i] as number, 9);
    });
  });

  it("mixed DAG log density differences match to double precision", () => {
    const stan = pairwiseDiffs(dagLp.map((r) => r.lp));
    const ref = pairwiseDiffs(mixedDagPoints.map((p) => mixedDagLogDensity(mixedDagData, p)));
    stan.forEach((d, i) => {
      expect(d).toBeCloseTo(ref[i] as number, 9);
    });
  });

  it("deterministic indirection yields the identical density as the direct mixture", () => {
    mixturePoints.forEach((p) => {
      const direct = logProb(mixtureBin, mixtureData, p);
      const indirect = logProb(mixtureDetBin, mixtureData, p);
      expect(indirect.lp).toBeCloseTo(direct.lp, 9);
    });
  }, 120_000);

  it("chain DAG (dependent priors) log density differences match to double precision", () => {
    const stan = pairwiseDiffs(chainLp.map((r) => r.lp));
    const ref = pairwiseDiffs(chainDagPoints.map((p) => chainDagLogDensity(chainDagData, p)));
    stan.forEach((d, i) => {
      expect(d).toBeCloseTo(ref[i] as number, 9);
    });
  });

  it("partially observed mixture log density differences match to double precision", () => {
    const stan = pairwiseDiffs(partialLp.map((r) => r.lp));
    const ref = pairwiseDiffs(
      mixturePoints.map((p) => mixturePartialLogDensity(mixturePartialData, p)),
    );
    stan.forEach((d, i) => {
      expect(d).toBeCloseTo(ref[i] as number, 9);
    });
  });

  it("binomial mixture (dbin latent) log density differences match to double precision", () => {
    const stan = pairwiseDiffs(binMixLp.map((r) => r.lp));
    const ref = pairwiseDiffs(binMixPoints.map((p) => binMixLogDensity(binMixData, p)));
    stan.forEach((d, i) => {
      expect(d).toBeCloseTo(ref[i] as number, 9);
    });
  });

  describe.runIf(Boolean(JULIA_PROJECT))("and JuliaBUGS auto-marginalization", () => {
    it("mixture values (up to a constant) and gradients agree", () => {
      const julia = juliaReference("mixture", mixtureData, mixturePoints, { sigma: "log" });
      expect(julia).toHaveLength(mixturePoints.length);
      const stanDiffs = pairwiseDiffs(mixtureLp.map((r) => r.lp));
      const juliaDiffs = pairwiseDiffs(julia.map((r) => r.logdensity));
      stanDiffs.forEach((d, i) => {
        expect(d).toBeCloseTo(juliaDiffs[i] as number, 9);
      });
      julia.forEach((ref, i) => {
        for (const [name, g] of Object.entries(ref.gradient)) {
          expect(mixtureLp[i]?.gradient[name]).toBeCloseTo(g, 8);
        }
      });
    }, 120_000);

    it("mixed DAG values (up to a constant) and gradients agree", () => {
      const julia = juliaReference("mixeddag", mixedDagData, mixedDagPoints);
      expect(julia).toHaveLength(mixedDagPoints.length);
      const stanDiffs = pairwiseDiffs(dagLp.map((r) => r.lp));
      const juliaDiffs = pairwiseDiffs(julia.map((r) => r.logdensity));
      stanDiffs.forEach((d, i) => {
        expect(d).toBeCloseTo(juliaDiffs[i] as number, 9);
      });
      julia.forEach((ref, i) => {
        for (const [name, g] of Object.entries(ref.gradient)) {
          expect(dagLp[i]?.gradient[name]).toBeCloseTo(g, 8);
        }
      });
    }, 120_000);

    it("partially observed mixture values (up to a constant) and gradients agree", () => {
      const julia = juliaReference("mixturepartial", mixturePartialData, mixturePoints, {
        sigma: "log",
      });
      expect(julia).toHaveLength(mixturePoints.length);
      const stanDiffs = pairwiseDiffs(partialLp.map((r) => r.lp));
      const juliaDiffs = pairwiseDiffs(julia.map((r) => r.logdensity));
      stanDiffs.forEach((d, i) => {
        expect(d).toBeCloseTo(juliaDiffs[i] as number, 9);
      });
      julia.forEach((ref, i) => {
        for (const [name, g] of Object.entries(ref.gradient)) {
          expect(partialLp[i]?.gradient[name]).toBeCloseTo(g, 8);
        }
      });
    }, 120_000);

    it("binomial mixture values (up to a constant) and gradients agree", () => {
      const julia = juliaReference("binmix", binMixData, binMixPoints, { phi: "logit" });
      expect(julia).toHaveLength(binMixPoints.length);
      const stanDiffs = pairwiseDiffs(binMixLp.map((r) => r.lp));
      const juliaDiffs = pairwiseDiffs(julia.map((r) => r.logdensity));
      stanDiffs.forEach((d, i) => {
        expect(d).toBeCloseTo(juliaDiffs[i] as number, 9);
      });
      julia.forEach((ref, i) => {
        for (const [name, g] of Object.entries(ref.gradient)) {
          expect(binMixLp[i]?.gradient[name]).toBeCloseTo(g, 8);
        }
      });
    }, 120_000);

    it("chain DAG values (up to a constant) and gradients agree", () => {
      const julia = juliaReference("chaindag", chainDagData, chainDagPoints, { sigma: "log" });
      expect(julia).toHaveLength(chainDagPoints.length);
      const stanDiffs = pairwiseDiffs(chainLp.map((r) => r.lp));
      const juliaDiffs = pairwiseDiffs(julia.map((r) => r.logdensity));
      stanDiffs.forEach((d, i) => {
        expect(d).toBeCloseTo(juliaDiffs[i] as number, 9);
      });
      julia.forEach((ref, i) => {
        for (const [name, g] of Object.entries(ref.gradient)) {
          expect(chainLp[i]?.gradient[name]).toBeCloseTo(g, 8);
        }
      });
    }, 120_000);
  });

  describe("latent recovery draws from the exact conditional posterior", () => {
    it("mixture: per-observation z frequencies match the averaged exact posterior", () => {
      const fit = sample(mixtureBin, mixtureData, { warmup: 500, draws: 1500, seed: 7 });
      const mu1 = fit.columns.get("mu[1]") as number[];
      const mu2 = fit.columns.get("mu[2]") as number[];
      const s1 = fit.columns.get("sigma[1]") as number[];
      const s2 = fit.columns.get("sigma[2]") as number[];
      for (let i = 0; i < mixtureData.N; i++) {
        const z = fit.columns.get(`z[${i + 1}]`) as number[];
        expect(z).toBeDefined();
        let expected = 0;
        let observed = 0;
        for (let t = 0; t < z.length; t++) {
          const p = {
            mu: [mu1[t] as number, mu2[t] as number],
            sigma: [s1[t] as number, s2[t] as number],
          };
          expected += mixtureZPosterior(mixtureData, p, i)[0] as number;
          observed += (z[t] as number) === 1 ? 1 : 0;
        }
        expect(observed / z.length).toBeCloseTo(expected / z.length, 1);
      }
    }, 120_000);

    it("mixed DAG: joint (X, Z, C) frequencies match the averaged exact posterior", () => {
      const fit = sample(dagBin, mixedDagData, { warmup: 500, draws: 2000, seed: 11 });
      const A = fit.columns.get("A") as number[];
      const B = fit.columns.get("B") as number[];
      const X = fit.columns.get("X") as number[];
      const Z = fit.columns.get("Z") as number[];
      const C = fit.columns.get("C") as number[];
      expect(X).toBeDefined();
      const expected = new Map<string, number>();
      const observed = new Map<string, number>();
      for (let t = 0; t < A.length; t++) {
        const joint = mixedDagJointPosterior(mixedDagData, {
          A: A[t] as number,
          B: B[t] as number,
        });
        for (const [key, p] of joint) {
          expected.set(key, (expected.get(key) ?? 0) + p);
        }
        const key = `${X[t]},${Z[t]},${C[t]}`;
        observed.set(key, (observed.get(key) ?? 0) + 1);
      }
      for (const [key, sum] of expected) {
        const freq = (observed.get(key) ?? 0) / A.length;
        expect(Math.abs(freq - sum / A.length)).toBeLessThan(0.05);
      }
    }, 120_000);

    it("partially observed mixture: observed entries are verbatim, missing follow the posterior", () => {
      const fit = sample(partialBin, partialData, { warmup: 500, draws: 1500, seed: 3 });
      const mu1 = fit.columns.get("mu[1]") as number[];
      const mu2 = fit.columns.get("mu[2]") as number[];
      const s1 = fit.columns.get("sigma[1]") as number[];
      const s2 = fit.columns.get("sigma[2]") as number[];
      for (let i = 0; i < mixturePartialData.N; i++) {
        const z = fit.columns.get(`z[${i + 1}]`) as number[];
        expect(z).toBeDefined();
        const observed = mixturePartialData.z[i];
        if (observed !== null && observed !== undefined) {
          expect(z.every((v) => v === observed)).toBe(true);
          continue;
        }
        let expected = 0;
        let freq = 0;
        for (let t = 0; t < z.length; t++) {
          const p = {
            mu: [mu1[t] as number, mu2[t] as number],
            sigma: [s1[t] as number, s2[t] as number],
          };
          expected += mixtureZPosterior(mixturePartialData, p, i)[0] as number;
          freq += (z[t] as number) === 1 ? 1 : 0;
        }
        expect(Math.abs(freq / z.length - expected / z.length)).toBeLessThan(0.05);
      }
    }, 120_000);

    it("binomial mixture: per-observation z frequencies match the averaged exact posterior", () => {
      const fit = sample(binMixBin, binMixData, { warmup: 500, draws: 1500, seed: 5 });
      const phi = fit.columns.get("phi") as number[];
      for (let i = 0; i < binMixData.N; i++) {
        const z = fit.columns.get(`z[${i + 1}]`) as number[];
        expect(z).toBeDefined();
        for (const k of [0, 1, 2, 3]) {
          let expected = 0;
          let observed = 0;
          for (let t = 0; t < z.length; t++) {
            expected += binMixZPosterior(binMixData, { phi: phi[t] as number }, i)[k] as number;
            observed += (z[t] as number) === k ? 1 : 0;
          }
          expect(Math.abs(observed / z.length - expected / z.length)).toBeLessThan(0.05);
        }
      }
    }, 120_000);

    it("chain DAG: joint (X, Y) frequencies match the averaged exact posterior", () => {
      const fit = sample(chainBin, chainDagData, { warmup: 500, draws: 2000, seed: 13 });
      const sigma = fit.columns.get("sigma") as number[];
      const X = fit.columns.get("X") as number[];
      const Y = fit.columns.get("Y") as number[];
      expect(X).toBeDefined();
      expect(Y).toBeDefined();
      const expected = new Map<string, number>();
      const observed = new Map<string, number>();
      for (let t = 0; t < sigma.length; t++) {
        const joint = chainDagJointPosterior(chainDagData, { sigma: sigma[t] as number });
        for (const [key, p] of joint) {
          expected.set(key, (expected.get(key) ?? 0) + p);
        }
        const key = `${X[t]},${Y[t]}`;
        observed.set(key, (observed.get(key) ?? 0) + 1);
      }
      for (const [key, sum] of expected) {
        const freq = (observed.get(key) ?? 0) / sigma.length;
        expect(Math.abs(freq - sum / sigma.length)).toBeLessThan(0.05);
      }
    }, 120_000);
  });
});
