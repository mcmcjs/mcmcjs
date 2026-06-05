/** Linear-interpolation quantile (type 7) of a pre-sorted ascending array. */
export function quantile(sorted: Float64Array, q: number): number {
  if (sorted.length === 0) return NaN;
  if (sorted.length === 1) return sorted[0] as number;
  const pos = q * (sorted.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  const frac = pos - lo;
  return (sorted[lo] as number) * (1 - frac) + (sorted[hi] as number) * frac;
}

/** Alias of {@link quantile}. */
export const computeQuantile = quantile;

/** Returns an ascending-sorted copy of the array. */
export function sortedCopy(arr: Float64Array): Float64Array {
  const copy = new Float64Array(arr);
  copy.sort();
  return copy;
}
