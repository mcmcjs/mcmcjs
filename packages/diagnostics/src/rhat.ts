/**
 * R-hat diagnostics — Vehtari et al. (2021) https://doi.org/10.1214/20-BA1221
 * Mirrors the reference implementation in MCMCDiagnosticTools.jl.
 */

import { _norminvcdf } from "./math";
import { computeQuantile, sortedCopy } from "./quantile";

export type RhatKind = "rank" | "bulk" | "tail" | "basic";

/**
 * Compute R-hat for an array of chains.
 * 'rank' (default) = max(bulk, tail) — strictest, recommended.
 * Returns NaN when undefined (< 2 chains, < 4 draws, zero within-chain variance).
 */
export function computeRhat(chains: Float64Array[], kind: RhatKind = "rank"): number {
  if (chains.length < 2) return NaN;
  // Match Stan's check on the raw split chains, before any rank-normalization
  // or folding (those transforms can turn a per-chain-constant input into
  // values that vary numerically due to FP residue, masking the constancy).
  if (!_isFiniteAndVaries(_splitChains(chains))) return NaN;
  switch (kind) {
    case "basic":
      return _rhatBasic(chains);
    case "bulk":
      return _rhatBasic(_rankNormalize(chains));
    case "tail":
      return _rhatBasic(_rankNormalize(_foldAroundMedian(chains)));
    case "rank": {
      const bulk = _rhatBasic(_rankNormalize(chains));
      const tail = _rhatBasic(_rankNormalize(_foldAroundMedian(chains)));
      if (Number.isNaN(bulk) && Number.isNaN(tail)) return NaN;
      if (Number.isNaN(bulk)) return tail;
      if (Number.isNaN(tail)) return bulk;
      return Math.max(bulk, tail);
    }
  }
}

// Gelman-Rubin with chain splitting (Vehtari 2021 Eq. 4).
// W is the unbiased (sample) within-chain variance — sum((x - mean)^2) / (n - 1).
/** @internal */
export function _rhatBasic(chains: Float64Array[], splitN = 2): number {
  const splits = _splitChains(chains, splitN);
  const m = splits.length;
  if (m < 2) return NaN;
  const n = (splits[0] as Float64Array).length;
  if (n < 3) return NaN;

  const chainMeans = splits.map(_mean);
  const chainVars = splits.map((c, i) => _unbiasedVariance(c, chainMeans[i] as number));
  const W = _arrayMean(chainVars);
  if (!Number.isFinite(W) || W === 0) return NaN;

  const grandMean = _arrayMean(chainMeans);
  let bSum = 0;
  for (let i = 0; i < m; i++) bSum += ((chainMeans[i] as number) - grandMean) ** 2;
  const B = (n / (m - 1)) * bSum;
  const varPlus = ((n - 1) / n) * W + B / n;
  return Math.sqrt(varPlus / W);
}

/** @internal */
export function _rankNormalize(chains: Float64Array[]): Float64Array[] {
  const total = chains.reduce((a, c) => a + c.length, 0);
  const pooled = new Float64Array(total);
  let offset = 0;
  for (const c of chains) {
    pooled.set(c, offset);
    offset += c.length;
  }

  const order = Array.from({ length: total }, (_, i) => i);
  order.sort((a, b) => (pooled[a] as number) - (pooled[b] as number));

  const ranks = new Float64Array(total);
  let i = 0;
  while (i < total) {
    let j = i;
    while (j + 1 < total && pooled[order[j] as number] === pooled[order[j + 1] as number]) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) ranks[order[k] as number] = avg;
    i = j + 1;
  }

  // Blom's correction then probit
  const out = new Float64Array(total);
  for (let idx = 0; idx < total; idx++) {
    out[idx] = _norminvcdf(((ranks[idx] as number) - 0.375) / (total + 0.25));
  }

  const result: Float64Array[] = [];
  offset = 0;
  for (const c of chains) {
    result.push(out.slice(offset, offset + c.length));
    offset += c.length;
  }
  return result;
}

/** @internal */
export function _foldAroundMedian(chains: Float64Array[]): Float64Array[] {
  const total = chains.reduce((a, c) => a + c.length, 0);
  const pooled = new Float64Array(total);
  let offset = 0;
  for (const c of chains) {
    pooled.set(c, offset);
    offset += c.length;
  }
  const median = computeQuantile(sortedCopy(pooled), 0.5);
  return chains.map((c) => {
    const f = new Float64Array(c.length);
    for (let i = 0; i < c.length; i++) f[i] = Math.abs((c[i] as number) - median);
    return f;
  });
}

/**
 * Split each chain into splitN equal halves.
 * Discards one draw after each of the first `rem` splits when length is uneven.
 * @internal
 */
export function _splitChains(chains: Float64Array[], splitN = 2): Float64Array[] {
  const result: Float64Array[] = [];
  for (const chain of chains) {
    const nIter = Math.floor(chain.length / splitN);
    if (nIter < 3) continue;
    const extra = chain.length % splitN;
    let cursor = 0;
    for (let s = 0; s < splitN; s++) {
      result.push(chain.slice(cursor, cursor + nIter));
      cursor += nIter + (s < extra ? 1 : 0);
    }
  }
  return result;
}

/**
 * Mirrors Stan's `is_finite_and_varies` (analyze/mcmc/check_chains.hpp).
 * Returns false when:
 *   - any element is non-finite, or
 *   - any single chain is effectively constant (every element equals its
 *     first draw under Eigen's isApprox tolerance), or
 *   - num_chains > 1 and every chain's first draw is the same value.
 * In any of these cases Stan returns NaN for ESS/R-hat/MCSE because the
 * within-chain variance estimate is dominated by FP residue and the formulas
 * explode. We mirror that behavior.
 *
 * Tolerance follows Eigen's `internal::isApprox(a, b, prec) = |a - b| <= prec * min(|a|, |b|)`
 * with prec = 1e-12 (NumTraits<double>::dummy_precision()).
 * @internal
 */
export function _isFiniteAndVaries(chains: Float64Array[], prec = 1e-12): boolean {
  if (chains.length === 0) return false;
  for (const c of chains) {
    if (c.length === 0) return false;
    const first = c[0] as number;
    if (!Number.isFinite(first)) return false;
    let approxConstant = true;
    for (let i = 0; i < c.length; i++) {
      const v = c[i] as number;
      if (!Number.isFinite(v)) return false;
      if (approxConstant) {
        const tol = prec * Math.min(Math.abs(v), Math.abs(first));
        if (Math.abs(v - first) > tol) approxConstant = false;
      }
    }
    if (approxConstant) return false;
  }
  if (chains.length > 1) {
    const first0 = (chains[0] as Float64Array)[0] as number;
    let allFirstsApprox = true;
    for (let i = 1; i < chains.length; i++) {
      const fi = (chains[i] as Float64Array)[0] as number;
      const tol = prec * Math.min(Math.abs(fi), Math.abs(first0));
      if (Math.abs(fi - first0) > tol) {
        allFirstsApprox = false;
        break;
      }
    }
    if (allFirstsApprox) return false;
  }
  return true;
}

/** @internal */
export function _mean(arr: Float64Array): number {
  if (arr.length === 0) return NaN;
  let s = 0;
  for (let i = 0; i < arr.length; i++) s += arr[i] as number;
  return s / arr.length;
}

/** @internal Biased (population) within-chain variance: sum((x - mean)^2) / n */
export function _biasedVariance(arr: Float64Array, mean: number): number {
  if (arr.length < 2) return NaN;
  let ss = 0;
  for (let i = 0; i < arr.length; i++) ss += ((arr[i] as number) - mean) ** 2;
  return ss / arr.length;
}

/** @internal Unbiased (sample) within-chain variance: sum((x - mean)^2) / (n - 1) */
export function _unbiasedVariance(arr: Float64Array, mean: number): number {
  if (arr.length < 2) return NaN;
  let ss = 0;
  for (let i = 0; i < arr.length; i++) ss += ((arr[i] as number) - mean) ** 2;
  return ss / (arr.length - 1);
}

/** @internal */
export function _arrayMean(arr: number[]): number {
  if (arr.length === 0) return NaN;
  let s = 0;
  for (const v of arr) s += v;
  return s / arr.length;
}
