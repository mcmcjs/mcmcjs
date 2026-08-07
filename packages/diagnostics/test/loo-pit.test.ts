import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { computeLooPit } from "../src/loo";

interface Fixture {
  chains: number;
  draws: number;
  observations: number;
  log_lik: number[][][];
  y_rep: number[][][];
  observed: number[];
  expected_pit: number[];
}

const fixture = JSON.parse(
  readFileSync(join(__dirname, "fixtures", "loo-pit-reference.json"), "utf8"),
) as Fixture;

/** (chains, draws, obs) -> per-observation chain arrays. */
function toPointwise(cube: number[][][], observations: number): Float64Array[][] {
  return Array.from({ length: observations }, (_, obs) =>
    cube.map((chain) => Float64Array.from(chain, (draw) => draw[obs] as number)),
  );
}

describe("computeLooPit", () => {
  const logLik = toPointwise(fixture.log_lik, fixture.observations);
  const yrep = toPointwise(fixture.y_rep, fixture.observations);

  it("matches the arviz reference values", () => {
    const pit = computeLooPit(logLik, yrep, fixture.observed);
    for (let i = 0; i < fixture.observations; i++) {
      expect(Math.abs((pit[i] as number) - (fixture.expected_pit[i] as number))).toBeLessThan(1e-6);
    }
  });

  it("stays within [0, 1] and reacts to shifting the observation", () => {
    const pit = computeLooPit(logLik, yrep, fixture.observed);
    for (const v of pit) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1 + 1e-12);
    }
    // An observation far below every replicate pins the PIT at 0; far above, at
    // the weight total (one, up to float round-off in the normalization).
    const low = computeLooPit(
      logLik,
      yrep,
      fixture.observed.map(() => -1e6),
    );
    const high = computeLooPit(
      logLik,
      yrep,
      fixture.observed.map(() => 1e6),
    );
    for (const v of low) expect(v).toBe(0);
    for (const v of high) expect(v).toBeCloseTo(1, 12);
  });

  it("gives ties the mid-p treatment", () => {
    const ll = [[new Float64Array(100).fill(-1)]];
    const rep = [[new Float64Array(100).fill(3)]];
    // Every replicate equals the observation: pit = 0.5 exactly.
    expect(computeLooPit(ll, rep, [3])[0]).toBeCloseTo(0.5, 12);
  });

  it("rejects mismatched shapes", () => {
    expect(() => computeLooPit(logLik, yrep.slice(0, 2), fixture.observed)).toThrow(
      /matching shapes/,
    );
    const shortRep = yrep.map((obs) => obs.map((c) => c.slice(0, 10)));
    expect(() => computeLooPit(logLik, shortRep, fixture.observed)).toThrow(/predictive draws/);
  });
});
