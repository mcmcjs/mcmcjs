/**
 * Monte Carlo Standard Error (MCSE) estimators.
 * Mean/Std: ESS-based asymptotic formula (Vehtari 2021).
 * Quantile: Beta distribution approximation (Flegal & Jones 2011).
 */

import { computeESS, computeEssBasic } from "./ess";
import { _betainvcdf } from "./math";
import { sortedCopy } from "./quantile";
import { computeMean, computeStdev } from "./summary";

/** MCSE of the mean for a single chain. */
export function computeMCSE(draws: Float64Array): number {
  if (draws.length < 4) return NaN;
  const sd = computeStdev(draws),
    { ess } = computeESS(draws);
  if (!Number.isFinite(sd) || !Number.isFinite(ess) || ess <= 0) return NaN;
  return sd / Math.sqrt(ess);
}

/** MCSE of the mean across multiple chains.
 *  Uses basic ESS on the raw expectand. Falls back to single-chain MCSE when chains
 *  are too short to split. */
export function computeMCSEMultiChain(chains: Float64Array[]): number {
  if (chains.length === 0) return NaN;
  const all = _concat(chains);
  const sd = computeStdev(all);
  if (!Number.isFinite(sd)) return NaN;
  const ess = computeEssBasic(chains);
  // Fall back to single-chain IMSE-based MCSE when chains are too short to split
  if (!Number.isFinite(ess) || ess <= 0) return computeMCSE(all);
  return sd / Math.sqrt(ess);
}

/**
 * MCSE of a quantile estimator (Flegal & Jones 2011).
 * @param p      quantile level 0–1
 * @param essEff effective sample size
 */
export function computeMCSEQuantile(draws: Float64Array, p: number, essEff: number): number {
  if (!Number.isFinite(essEff) || essEff <= 0 || draws.length < 4) return NaN;
  const S = draws.length;
  const α = essEff * p + 1,
    β = essEff * (1 - p) + 1;
  const probU = _betainvcdf(0.8413447460685429, α, β); // Φ(1)
  const probL = _betainvcdf(0.1586552539314571, α, β); // Φ(-1)
  const sorted = sortedCopy(draws);
  const xl = sorted[Math.max(Math.floor(probL * S), 0)] as number;
  const xu = sorted[Math.min(Math.ceil(probU * S), S - 1)] as number;
  return (xu - xl) / 2;
}

/** MCSE of the standard deviation via delta method applied to the squared-residual
 *  proxy `(x - mean(x))^2`, combined with basic ESS of that proxy. */
export function computeMCSEStd(chains: Float64Array[]): number {
  if (chains.length === 0) return NaN;
  const all = _concat(chains);
  const mu = computeMean(all);
  if (!Number.isFinite(mu)) return NaN;

  const proxyChains = chains.map((c) => {
    const pc = new Float64Array(c.length);
    for (let i = 0; i < c.length; i++) pc[i] = ((c[i] as number) - mu) ** 2;
    return pc;
  });
  const proxy = _concat(proxyChains);
  const meanV = computeMean(proxy);
  let meanM4 = 0;
  for (let i = 0; i < proxy.length; i++) meanM4 += (proxy[i] as number) ** 2;
  meanM4 /= proxy.length;

  const ess = computeEssBasic(proxyChains);
  if (!Number.isFinite(ess) || ess <= 0 || meanV <= 0) return NaN;
  return Math.sqrt((meanM4 / meanV - meanV) / ess) / 2;
}

// Backward-compatible re-exports
/** @deprecated Use computeEssBulk from ess.ts */
/** @deprecated Use computeEssTail from ess.ts */
export {
  computeEssBulk as computeBulkESS,
  computeEssTail as computeTailESS,
} from "./ess";

function _concat(chains: Float64Array[]): Float64Array {
  let len = 0;
  for (const c of chains) len += c.length;
  const out = new Float64Array(len);
  let offset = 0;
  for (const c of chains) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}
