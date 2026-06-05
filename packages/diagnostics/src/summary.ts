import { quantile, sortedCopy } from "./quantile";

export function computeMean(arr: Float64Array): number {
  if (arr.length === 0) return NaN;
  let sum = 0;
  for (const v of arr) sum += v;
  return sum / arr.length;
}

/** Sample (unbiased) standard deviation: sqrt(sum((x - mean)^2) / (n - 1)).
 *  Matches R's `sd`, numpy with `ddof=1`, and Julia's `Statistics.std`. */
export function computeStdev(arr: Float64Array): number {
  if (arr.length <= 1) return NaN;
  const m = computeMean(arr);
  let ss = 0;
  for (const v of arr) {
    const d = v - m;
    ss += d * d;
  }
  // Clamp against floating-point round-off turning a near-zero variance negative.
  return Math.sqrt(Math.max(0, ss / (arr.length - 1)));
}

export function computeSkewness(arr: Float64Array): number {
  if (arr.length < 3) return NaN;
  const mean = computeMean(arr);
  const sd = computeStdev(arr);
  if (!Number.isFinite(sd) || sd === 0) return 0;

  let thirdMoment = 0;
  for (const v of arr) {
    thirdMoment += (v - mean) ** 3;
  }

  return thirdMoment / arr.length / sd ** 3;
}

export function computeExcessKurtosis(arr: Float64Array): number {
  if (arr.length < 4) return NaN;
  const mean = computeMean(arr);
  const sd = computeStdev(arr);
  if (!Number.isFinite(sd) || sd === 0) return 0;

  let fourthMoment = 0;
  for (const v of arr) {
    fourthMoment += (v - mean) ** 4;
  }

  return fourthMoment / arr.length / sd ** 4 - 3;
}

export function computeQuantiles(arr: Float64Array) {
  const sorted = sortedCopy(arr);
  return {
    q5: quantile(sorted, 0.05),
    q25: quantile(sorted, 0.25),
    q50: quantile(sorted, 0.5),
    q75: quantile(sorted, 0.75),
    q95: quantile(sorted, 0.95),
  };
}

export function computeHDI(arr: Float64Array, credMass = 0.9): [number, number] {
  const sorted = sortedCopy(arr);
  const n = sorted.length;
  if (n === 0) return [NaN, NaN];
  if (n === 1) return [sorted[0] as number, sorted[0] as number];
  const intervalSize = Math.ceil(credMass * n);
  if (intervalSize >= n) return [sorted[0] as number, sorted[n - 1] as number];

  let bestWidth = Infinity;
  let bestLo = 0;

  for (let i = 0; i <= n - intervalSize; i++) {
    const width = (sorted[i + intervalSize - 1] as number) - (sorted[i] as number);
    if (width < bestWidth) {
      bestWidth = width;
      bestLo = i;
    }
  }

  return [sorted[bestLo] as number, sorted[bestLo + intervalSize - 1] as number];
}
