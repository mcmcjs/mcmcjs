/** Compact numeric label: up to 3 decimals, exponential for extreme magnitudes, "n/a" for non-finite. */
export function fmtNum(n: number): string {
  if (!Number.isFinite(n)) return "n/a";
  const a = Math.abs(n);
  if (a !== 0 && (a < 1e-3 || a >= 1e5)) return n.toExponential(1);
  return Number(n.toFixed(3)).toString();
}

/** The finite [min, max] of a sequence, ignoring non-finite values; [0, 1] when empty. */
export function extent(values: Iterable<number>): [number, number] {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const v of values) {
    if (!Number.isFinite(v)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 1];
  return [min, max];
}
