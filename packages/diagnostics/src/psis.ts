/**
 * Pareto-smoothed importance sampling (PSIS), after Vehtari, Simpson, Gelman,
 * Yao and Gabry (2024), matching the arviz-stats reference implementation.
 * The largest importance ratios are replaced by quantiles of a generalized
 * Pareto distribution fitted to them; the fitted shape k-hat doubles as the
 * reliability diagnostic.
 */

const EPS = 2.220446049250313e-16;

/** log(sum(exp(x))) computed stably; -Infinity for an empty input. */
export function logSumExp(values: ArrayLike<number>): number {
  let max = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < values.length; i++) {
    const v = values[i] as number;
    if (v > max) max = v;
  }
  if (!Number.isFinite(max)) return max;
  let sum = 0;
  for (let i = 0; i < values.length; i++) sum += Math.exp((values[i] as number) - max);
  return max + Math.log(sum);
}

/**
 * Fits a generalized Pareto distribution to exceedances by the empirical Bayes
 * method of Zhang and Stephens (2009), with the weak prior on k used by the
 * reference implementations. `x` must be sorted ascending and non-negative.
 * Returns k = Infinity when the sample is degenerate.
 */
export function gpdFit(x: ArrayLike<number>): { k: number; sigma: number } {
  const n = x.length;
  if (n === 0) return { k: Number.POSITIVE_INFINITY, sigma: Number.NaN };
  const priorBs = 3;
  const priorK = 10;
  const m = 30 + Math.floor(Math.sqrt(n));

  const quartile = x[Math.floor(n / 4 + 0.5) - 1] as number;
  const last = x[n - 1] as number;
  // A first quartile at the minimum says the sample is far from Pareto.
  if (quartile <= (x[0] as number)) return { k: Number.POSITIVE_INFINITY, sigma: Number.NaN };

  const bs = new Float64Array(m);
  for (let j = 0; j < m; j++) {
    bs[j] = (1 - Math.sqrt(m / (j + 0.5))) / (priorBs * quartile) + 1 / last;
  }

  const ks = new Float64Array(m);
  for (let j = 0; j < m; j++) {
    let acc = 0;
    for (let i = 0; i < n; i++) acc += Math.log1p(-(bs[j] as number) * (x[i] as number));
    ks[j] = acc / n;
  }

  const logLik = new Float64Array(m);
  for (let j = 0; j < m; j++) {
    logLik[j] = n * (Math.log(-(bs[j] as number) / (ks[j] as number)) - (ks[j] as number) - 1);
  }

  const norm = logSumExp(logLik);
  let total = 0;
  let bPost = 0;
  for (let j = 0; j < m; j++) {
    const w = Math.exp((logLik[j] as number) - norm);
    if (w < 10 * EPS) continue;
    total += w;
    bPost += (bs[j] as number) * w;
  }
  bPost /= total;

  let kPost = 0;
  for (let i = 0; i < n; i++) kPost += Math.log1p(-bPost * (x[i] as number));
  kPost /= n;
  // sigma comes from the raw fit; only the reported k carries the weak prior.
  const sigma = -kPost / bPost;
  kPost = (n * kPost + priorK * 0.5) / (n + priorK);
  if (Number.isNaN(kPost)) return { k: Number.POSITIVE_INFINITY, sigma: Number.NaN };

  return { k: kPost, sigma };
}

/** Inverse CDF of the generalized Pareto distribution at probabilities in (0, 1). */
function gpdQuantile(p: number, k: number, sigma: number): number {
  if (sigma <= 0) return Number.NaN;
  return sigma * (k === 0 ? -Math.log1p(-p) : Math.expm1(-k * Math.log1p(-p)) / k);
}

export interface PsisResult {
  /** Smoothed log weights, normalized so logSumExp(logWeights) = 0. */
  logWeights: Float64Array;
  /** The fitted Pareto shape; Infinity when the tail was too short or degenerate. */
  k: number;
}

/**
 * Smooths one observation's log importance ratios. The tail is the largest
 * `floor(3 sqrt(S / reff))` ratios (or S/5 for small effective samples); when
 * it holds at least five values it is replaced with fitted GPD quantiles,
 * capped at the largest ratio. Weights come back log-scale, summing to one.
 */
export function psisSmooth(logRatios: ArrayLike<number>, reff = 1): PsisResult {
  const s = logRatios.length;
  const x = new Float64Array(s);
  let max = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < s; i++) {
    const v = logRatios[i] as number;
    if (v > max) max = v;
  }
  for (let i = 0; i < s; i++) x[i] = (logRatios[i] as number) - max;

  const m = s * reff > 225 ? Math.floor(3 * Math.sqrt(s / reff)) : Math.floor(s / 5);
  let k = Number.POSITIVE_INFINITY;
  if (m >= 5 && m < s) {
    const order = Array.from({ length: s }, (_, i) => i).sort(
      (a, b) => (x[a] as number) - (x[b] as number),
    );
    const tailIds = order.slice(s - m);
    const maxTail = x[tailIds[m - 1] as number] as number;
    const minTail = x[tailIds[0] as number] as number;
    if (Math.abs(maxTail - minTail) >= Number.MIN_VALUE) {
      const cutoff = Math.exp(x[order[s - m - 1] as number] as number);
      const exceedances = tailIds.map((i) => Math.exp(x[i] as number) - cutoff);
      const fit = gpdFit(exceedances);
      k = fit.k;
      if (Number.isFinite(k)) {
        for (let j = 0; j < m; j++) {
          const p = (j + 0.5) / m;
          const smoothed = Math.log(gpdQuantile(p, k, fit.sigma) + cutoff);
          x[tailIds[j] as number] = Math.min(smoothed, maxTail);
        }
      }
    }
  }

  const norm = logSumExp(x);
  for (let i = 0; i < s; i++) x[i] = (x[i] as number) - norm;
  return { logWeights: x, k };
}
