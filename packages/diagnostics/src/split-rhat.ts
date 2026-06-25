import { computeMean, computeStdev } from "./summary";

/**
 * Classic (non-rank-normalized) split-R-hat. Each chain is split into two halves
 * of `floor(len / 2)` draws (so 2 chains become 4 split-chains), then the standard
 * Gelman-Rubin ratio is formed with the within-chain variance W taken as the mean
 * of the sample (ddof=1) variances. Distinct from the rank-normalized R-hat in
 * `rhat.ts`. Returns NaN when a half has fewer than 2 draws or W is zero.
 */
export function splitRhat(chains: Float64Array[]): number {
  const halves: Float64Array[] = [];
  for (const chain of chains) {
    const half = Math.floor(chain.length / 2);
    if (half < 2) return Number.NaN;
    halves.push(chain.slice(0, half));
    halves.push(chain.slice(half, half + half));
  }
  const m = halves.length;
  if (m <= 1) return Number.NaN;

  const n = (halves[0] as Float64Array).length;
  const means = halves.map((h) => computeMean(h));
  let grandSum = 0;
  for (const mu of means) grandSum += mu;
  const grandMean = grandSum / m;

  let bSum = 0;
  for (const mu of means) bSum += (mu - grandMean) ** 2;
  const B = (n / (m - 1)) * bSum;

  let wSum = 0;
  for (const h of halves) {
    const sd = computeStdev(h);
    wSum += sd * sd;
  }
  const W = wSum / m;
  if (W === 0 || !Number.isFinite(W)) return Number.NaN;

  const varHat = ((n - 1) / n) * W + B / n;
  return Math.sqrt(varHat / W);
}
