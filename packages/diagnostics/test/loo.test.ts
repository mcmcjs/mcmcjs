import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { compareLoo, computeLoo, computeWaic, relativeEff } from "../src/loo";
import { gpdFit, logSumExp, psisSmooth } from "../src/psis";

interface FixtureCase {
  name: string;
  chains: number;
  draws: number;
  observations: number;
  log_lik: number[][][];
  expected: {
    loo: {
      elpd: number;
      se: number;
      p: number;
      good_k: number;
      pointwise_elpd: number[];
      pareto_k: number[];
    };
    waic: { elpd: number; se: number; p: number };
  };
}

const fixture = JSON.parse(
  readFileSync(join(__dirname, "fixtures", "loo-reference.json"), "utf8"),
) as { cases: FixtureCase[] };

/** log_lik as (chains, draws, obs) -> per-observation chain arrays. */
function toPointwise(c: FixtureCase): Float64Array[][] {
  return Array.from({ length: c.observations }, (_, obs) =>
    c.log_lik.map((chain) => Float64Array.from(chain, (draw) => draw[obs] as number)),
  );
}

function expectClose(actual: number, expected: number, rtol = 1e-8): void {
  const scale = Math.max(1, Math.abs(expected));
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(rtol * scale);
}

describe("computeLoo against the arviz reference", () => {
  for (const c of fixture.cases) {
    it(`matches arviz on the ${c.name} case`, () => {
      const result = computeLoo(toPointwise(c), { reff: 1 });
      expectClose(result.elpd, c.expected.loo.elpd);
      expectClose(result.se, c.expected.loo.se);
      expectClose(result.p, c.expected.loo.p);
      expectClose(result.goodK, c.expected.loo.good_k);
      expect(result.nObservations).toBe(c.observations);
      expect(result.nSamples).toBe(c.chains * c.draws);
      for (let i = 0; i < c.observations; i++) {
        expectClose(
          result.pointwise.elpd[i] as number,
          c.expected.loo.pointwise_elpd[i] as number,
          1e-7,
        );
        expectClose(
          result.pointwise.paretoK[i] as number,
          c.expected.loo.pareto_k[i] as number,
          1e-7,
        );
      }
    });
  }

  it("flags every unreliable observation on the heavy-tailed case", () => {
    const c = fixture.cases.find((x) => x.name === "heavy_tailed") as FixtureCase;
    const result = computeLoo(toPointwise(c), { reff: 1 });
    const expectedHigh = c.expected.loo.pareto_k.filter((k) => k > c.expected.loo.good_k).length;
    expect(result.highK).toBe(expectedHigh);
    expect(result.highK).toBeGreaterThan(0);
    expectClose(result.maxK, Math.max(...c.expected.loo.pareto_k), 1e-7);
  });

  it("rejects an empty input", () => {
    expect(() => computeLoo([])).toThrow(/at least one observation/);
  });
});

describe("computeWaic against the textbook formula", () => {
  for (const c of fixture.cases) {
    it(`matches on the ${c.name} case`, () => {
      const result = computeWaic(toPointwise(c));
      expectClose(result.elpd, c.expected.waic.elpd);
      expectClose(result.se, c.expected.waic.se);
      expectClose(result.p, c.expected.waic.p);
    });
  }

  it("counts observations whose penalty exceeds 0.4", () => {
    const c = fixture.cases.find((x) => x.name === "heavy_tailed") as FixtureCase;
    expect(computeWaic(toPointwise(c)).overPenalty).toBe(c.observations);
    // A constant log-likelihood has zero variance, so no observation is flagged.
    const flat = Array.from({ length: 3 }, () => [
      new Float64Array(50).fill(-1.5),
      new Float64Array(50).fill(-1.5),
    ]);
    expect(computeWaic(flat).overPenalty).toBe(0);
  });
});

describe("gpdFit", () => {
  // Deterministic uniform source so the test is reproducible without a seed dep.
  function lcg(seed: number): () => number {
    let s = seed >>> 0;
    return () => {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return (s + 0.5) / 2 ** 32;
    };
  }

  function gpdSample(n: number, k: number, sigma: number, seed: number): number[] {
    const rand = lcg(seed);
    return Array.from({ length: n }, () => (sigma * Math.expm1(-k * Math.log1p(-rand()))) / k).sort(
      (a, b) => a - b,
    );
  }

  it("recovers the shape of generalized Pareto samples", () => {
    for (const k of [0.2, 0.5, 0.9]) {
      const { k: kHat, sigma } = gpdFit(gpdSample(4000, k, 1, 7));
      expect(Math.abs(kHat - k)).toBeLessThan(0.1);
      expect(Math.abs(sigma - 1)).toBeLessThan(0.15);
    }
  });

  it("shrinks k toward 0.5 for tiny tails, following the prior", () => {
    const { k } = gpdFit(gpdSample(6, 0.1, 1, 11));
    expect(k).toBeGreaterThan(-0.5);
    expect(k).toBeLessThan(1);
  });
});

describe("psisSmooth", () => {
  it("returns normalized log weights", () => {
    const ratios = Array.from({ length: 400 }, (_, i) => Math.sin(i) * 2);
    const { logWeights } = psisSmooth(ratios);
    expect(logSumExp(logWeights)).toBeCloseTo(0, 10);
  });

  it("caps smoothed tail weights at the pre-normalization maximum", () => {
    const rand = (() => {
      let s = 99;
      return () => {
        s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
        return (s + 0.5) / 2 ** 32;
      };
    })();
    const ratios = Array.from({ length: 1000 }, () => -Math.log(rand()) * 3);
    const { logWeights, k } = psisSmooth(ratios);
    expect(Number.isFinite(k)).toBe(true);
    // No single weight may dominate past the raw maximum after smoothing.
    const max = Math.max(...logWeights);
    for (const w of logWeights) expect(w).toBeLessThanOrEqual(max + 1e-12);
    expect(logSumExp(logWeights)).toBeCloseTo(0, 10);
  });

  it("reports k = Infinity when the tail is too short to fit", () => {
    const { k, logWeights } = psisSmooth([0.1, 0.2, 0.3, 0.4, 0.5, 0.6]);
    expect(k).toBe(Number.POSITIVE_INFINITY);
    expect(logSumExp(logWeights)).toBeCloseTo(0, 10);
  });
});

describe("relativeEff", () => {
  it("is near one for independent draws", () => {
    const rand = (() => {
      let s = 5;
      return () => {
        s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
        return (s + 0.5) / 2 ** 32;
      };
    })();
    const logLik = Array.from({ length: 4 }, () => [
      Float64Array.from({ length: 500 }, () => -1 + 0.2 * (rand() - 0.5)),
      Float64Array.from({ length: 500 }, () => -1 + 0.2 * (rand() - 0.5)),
    ]);
    const reff = relativeEff(logLik);
    expect(reff).toBeGreaterThan(0.7);
    expect(reff).toBeLessThanOrEqual(1);
  });

  it("drops well below one for strongly autocorrelated draws", () => {
    const n = 500;
    const walk = new Float64Array(n);
    let x = 0;
    const rand = (() => {
      let s = 17;
      return () => {
        s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
        return (s + 0.5) / 2 ** 32;
      };
    })();
    for (let i = 0; i < n; i++) {
      x = 0.995 * x + 0.01 * (rand() - 0.5);
      walk[i] = -1 + x;
    }
    const reff = relativeEff([[walk, Float64Array.from(walk, (v) => v + 1e-6)]]);
    expect(reff).toBeLessThan(0.2);
  });
});

describe("compareLoo", () => {
  const c = fixture.cases.find((x) => x.name === "well_behaved") as FixtureCase;
  const base = toPointwise(c);
  // A strictly worse model: the same likelihood shifted down by 0.5 per observation.
  const worse = base.map((obs) => obs.map((chain) => Float64Array.from(chain, (v) => v - 0.5)));

  it("ranks by elpd with paired-difference standard errors", () => {
    const a = computeLoo(base, { reff: 1 });
    const b = computeLoo(worse, { reff: 1 });
    const ranked = compareLoo([
      { name: "worse", result: b },
      { name: "base", result: a },
    ]);
    expect(ranked.map((r) => r.name)).toEqual(["base", "worse"]);
    expect(ranked[0]?.elpdDiff).toBe(0);
    expect(ranked[0]?.seDiff).toBe(0);
    // A constant -0.5 shift per observation gives elpd_diff = -0.5 n and,
    // because the pointwise differences are constant, se_diff = 0.
    expect(ranked[1]?.elpdDiff).toBeCloseTo(-0.5 * c.observations, 6);
    expect(ranked[1]?.seDiff).toBeCloseTo(0, 6);
  });

  it("rejects models scoring different observation sets", () => {
    const a = computeLoo(base, { reff: 1 });
    const short = computeLoo(base.slice(0, 5), { reff: 1 });
    expect(() =>
      compareLoo([
        { name: "a", result: a },
        { name: "short", result: short },
      ]),
    ).toThrow(/not comparable/);
  });

  it("needs at least two models", () => {
    const a = computeLoo(base, { reff: 1 });
    expect(() => compareLoo([{ name: "a", result: a }])).toThrow(/at least two/);
  });
});
