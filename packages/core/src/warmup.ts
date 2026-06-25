import type { Samples } from "./types";

/**
 * Returns a new `Samples` discarding the first `n` draws of every chain. The
 * chain-major layout is rebuilt (not a naive flat slice): for each variable and
 * sampler stat, draws `[n .. nDraws)` are copied per chain. `n` is clamped to
 * `[0, nDraws]`, so `n >= nDraws` yields empty series with `nDraws = 0`.
 */
export function dropWarmup(samples: Samples, n: number): Samples {
  const drop = Math.min(Math.max(0, n), samples.nDraws);
  const newDraws = samples.nDraws - drop;
  const rebuild = (all: Float64Array): Float64Array => {
    const out = new Float64Array(samples.nChains * newDraws);
    for (let c = 0; c < samples.nChains; c++) {
      const src = c * samples.nDraws + drop;
      out.set(all.subarray(src, src + newDraws), c * newDraws);
    }
    return out;
  };

  const draws = new Map<string, Float64Array>();
  for (const [variable, all] of samples.draws) draws.set(variable, rebuild(all));
  const sampleStats = new Map<string, Float64Array>();
  for (const [stat, all] of samples.sampleStats) sampleStats.set(stat, rebuild(all));

  return {
    variables: samples.variables,
    nChains: samples.nChains,
    nDraws: newDraws,
    draws,
    sampleStats,
  };
}
