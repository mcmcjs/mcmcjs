/**
 * Linear and rank correlation between two equal-length series. Both reduce to the
 * Pearson product-moment coefficient; Spearman applies it to the values' ranks.
 */

/** Pearson product-moment correlation over the first `min(len)` pairs; 0 when undefined. */
export function pearson(xs: ArrayLike<number>, ys: ArrayLike<number>): number {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return 0;
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < n; i++) {
    sx += xs[i] ?? 0;
    sy += ys[i] ?? 0;
  }
  const mx = sx / n;
  const my = sy / n;
  let num = 0;
  let dx2 = 0;
  let dy2 = 0;
  for (let i = 0; i < n; i++) {
    const dx = (xs[i] ?? 0) - mx;
    const dy = (ys[i] ?? 0) - my;
    num += dx * dy;
    dx2 += dx * dx;
    dy2 += dy * dy;
  }
  const denom = Math.sqrt(dx2 * dy2);
  return denom < 1e-12 ? 0 : num / denom;
}

/** 1-based argsort ranks, no tie-averaging (ties take consecutive ranks by index order). */
function rank(arr: ArrayLike<number>): Float64Array {
  const n = arr.length;
  const idx = Array.from({ length: n }, (_, i) => i).sort((a, b) => (arr[a] ?? 0) - (arr[b] ?? 0));
  const ranks = new Float64Array(n);
  for (let i = 0; i < n; i++) ranks[idx[i] ?? 0] = i + 1;
  return ranks;
}

/** Spearman rank correlation: the Pearson correlation of the two series' ranks. */
export function spearman(xs: ArrayLike<number>, ys: ArrayLike<number>): number {
  return pearson(rank(xs), rank(ys));
}
