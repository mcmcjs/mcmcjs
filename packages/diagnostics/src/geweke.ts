import { _normcdf } from "./math";
import { computeMean, computeStdev } from "./summary";

export interface GewekeResult {
  z: number;
  pValue: number;
}

/**
 * Bartlett/triangular-windowed spectral-density-at-0 estimate (the long-run
 * variance). Autocovariances use the biased 1/n estimator by design; the sample
 * stdev is used only as a degeneracy guard, not as a scale factor.
 */
function spectralDensityAt0(draws: Float64Array): number {
  const n = draws.length;
  const mean = computeMean(draws);
  const sd = computeStdev(draws);
  if (Number.isNaN(sd) || sd === 0) return 0;

  const maxLag = Math.min(n - 1, Math.floor(n * 0.2));
  let gamma0 = 0;
  for (let i = 0; i < n; i++) {
    const d = (draws[i] as number) - mean;
    gamma0 += d * d;
  }
  let s = gamma0 / n;
  for (let lag = 1; lag <= maxLag; lag++) {
    const weight = 1 - lag / (maxLag + 1);
    let gamma = 0;
    for (let i = 0; i < n - lag; i++) {
      gamma += ((draws[i] as number) - mean) * ((draws[i + lag] as number) - mean);
    }
    s += (2 * weight * gamma) / n;
  }
  return Math.max(0, s);
}

/**
 * Geweke (1992) convergence z-diagnostic: compares the mean of the first
 * `firstFrac` of the chain to the mean of the last `lastFrac`, standardized by a
 * Bartlett-windowed spectral-density-at-0 standard error. Returns `{ z, pValue }`
 * (both NaN when the chain is too short or degenerate).
 */
export function geweke(chain: Float64Array, firstFrac = 0.1, lastFrac = 0.5): GewekeResult {
  const n = chain.length;
  if (n < 20) return { z: Number.NaN, pValue: Number.NaN };

  const nFirst = Math.floor(n * firstFrac);
  const nLast = Math.floor(n * lastFrac);
  if (nFirst < 2 || nLast < 2) return { z: Number.NaN, pValue: Number.NaN };

  const firstPart = chain.slice(0, nFirst);
  const lastPart = chain.slice(n - nLast);
  const meanFirst = computeMean(firstPart);
  const meanLast = computeMean(lastPart);
  const seFirst = spectralDensityAt0(firstPart);
  const seLast = spectralDensityAt0(lastPart);
  if (seFirst + seLast <= 0) return { z: Number.NaN, pValue: Number.NaN };

  const z = (meanFirst - meanLast) / Math.sqrt(seFirst / nFirst + seLast / nLast);
  const pValue = 2 * (1 - _normcdf(Math.abs(z)));
  return { z, pValue };
}
