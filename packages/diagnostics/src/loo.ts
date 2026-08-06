/**
 * PSIS-LOO cross-validation and WAIC, after Vehtari, Gelman and Gabry (2017).
 * Input is the pointwise log-likelihood: one entry per observation, holding
 * that observation's log-likelihood per chain at every posterior draw.
 */

import { computeEssBasic } from "./ess";
import { logSumExp, psisSmooth } from "./psis";

/** One observation's log-likelihood values, one Float64Array per chain. */
export type PointwiseLogLik = Float64Array[];

export interface LooPointwise {
  /** elpd_loo contribution per observation. */
  elpd: Float64Array;
  /** Pareto k-hat per observation. */
  paretoK: Float64Array;
}

export interface LooResult {
  kind: "loo";
  /** Expected log pointwise predictive density, PSIS-LOO estimate. */
  elpd: number;
  se: number;
  /** Effective number of parameters. */
  p: number;
  /** k-hat values at or below this are reliable: min(1 - 1/log10(S), 0.7). */
  goodK: number;
  /** Observations whose k-hat exceeds goodK (unreliable elpd contributions). */
  highK: number;
  maxK: number;
  nObservations: number;
  nSamples: number;
  pointwise: LooPointwise;
}

export interface WaicResult {
  kind: "waic";
  elpd: number;
  se: number;
  p: number;
  /** Observations with p_waic_i > 0.4, where the WAIC approximation is doubtful. */
  overPenalty: number;
  nObservations: number;
  nSamples: number;
}

function pooled(chains: Float64Array[]): Float64Array {
  const total = chains.reduce((n, c) => n + c.length, 0);
  const out = new Float64Array(total);
  let at = 0;
  for (const chain of chains) {
    out.set(chain, at);
    at += chain.length;
  }
  return out;
}

function variance(values: ArrayLike<number>, mean: number, ddof: number): number {
  let acc = 0;
  for (let i = 0; i < values.length; i++) acc += ((values[i] as number) - mean) ** 2;
  return acc / (values.length - ddof);
}

/** sqrt(n * population variance), the reference convention for elpd errors. */
function seOfTotal(pointwise: ArrayLike<number>): number {
  const n = pointwise.length;
  let mean = 0;
  for (let i = 0; i < n; i++) mean += pointwise[i] as number;
  mean /= n;
  return Math.sqrt(n * variance(pointwise, mean, 0));
}

/**
 * Relative efficiency of the likelihood: ESS of exp(loglik) over the total
 * draw count, averaged across observations. Computed on centered values so
 * the exponential cannot overflow.
 */
export function relativeEff(logLik: PointwiseLogLik[]): number {
  let acc = 0;
  for (const obs of logLik) {
    let max = Number.NEGATIVE_INFINITY;
    for (const chain of obs) {
      for (const v of chain) if (v > max) max = v;
    }
    const ratios = obs.map((chain) => Float64Array.from(chain, (v) => Math.exp(v - max)));
    const total = ratios.reduce((n, c) => n + c.length, 0);
    const ess = computeEssBasic(ratios);
    acc += (Number.isFinite(ess) ? Math.min(ess, total) : total) / total;
  }
  return acc / logLik.length;
}

/** PSIS-LOO. Pass `reff` to override the relative efficiency (1 = iid draws). */
export function computeLoo(logLik: PointwiseLogLik[], opts: { reff?: number } = {}): LooResult {
  const n = logLik.length;
  if (n === 0) throw new Error("loo needs at least one observation");
  const reff = opts.reff ?? relativeEff(logLik);
  const nSamples = logLik[0]?.reduce((t, c) => t + c.length, 0) ?? 0;

  const elpdI = new Float64Array(n);
  const paretoK = new Float64Array(n);
  const lpdI = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const ll = pooled(logLik[i] as PointwiseLogLik);
    const ratios = Float64Array.from(ll, (v) => -v);
    const { logWeights, k } = psisSmooth(ratios, reff);
    const joint = Float64Array.from(ll, (v, s) => v + (logWeights[s] as number));
    elpdI[i] = logSumExp(joint);
    paretoK[i] = k;
    lpdI[i] = logSumExp(ll) - Math.log(ll.length);
  }

  let elpd = 0;
  let p = 0;
  let highK = 0;
  let maxK = Number.NEGATIVE_INFINITY;
  const goodK = Math.min(1 - 1 / Math.log10(nSamples), 0.7);
  for (let i = 0; i < n; i++) {
    elpd += elpdI[i] as number;
    p += (lpdI[i] as number) - (elpdI[i] as number);
    const k = paretoK[i] as number;
    if (k > goodK) highK += 1;
    if (k > maxK) maxK = k;
  }

  return {
    kind: "loo",
    elpd,
    se: seOfTotal(elpdI),
    p,
    goodK,
    highK,
    maxK,
    nObservations: n,
    nSamples,
    pointwise: { elpd: elpdI, paretoK },
  };
}

/** WAIC with the variance-based penalty (p_waic 2). */
export function computeWaic(logLik: PointwiseLogLik[]): WaicResult {
  const n = logLik.length;
  if (n === 0) throw new Error("waic needs at least one observation");
  const nSamples = logLik[0]?.reduce((t, c) => t + c.length, 0) ?? 0;

  const elpdI = new Float64Array(n);
  let p = 0;
  let overPenalty = 0;
  for (let i = 0; i < n; i++) {
    const ll = pooled(logLik[i] as PointwiseLogLik);
    const lpd = logSumExp(ll) - Math.log(ll.length);
    let mean = 0;
    for (const v of ll) mean += v;
    mean /= ll.length;
    const penalty = variance(ll, mean, 1);
    elpdI[i] = lpd - penalty;
    p += penalty;
    if (penalty > 0.4) overPenalty += 1;
  }

  let elpd = 0;
  for (let i = 0; i < n; i++) elpd += elpdI[i] as number;
  return {
    kind: "waic",
    elpd,
    se: seOfTotal(elpdI),
    p,
    overPenalty,
    nObservations: n,
    nSamples,
  };
}

export interface LooComparison {
  /** The model's label, as given. */
  name: string;
  result: LooResult;
  /** elpd difference to the top-ranked model (0 for the best). */
  elpdDiff: number;
  /** Standard error of the difference, from the paired pointwise elpds. */
  seDiff: number;
}

/**
 * Ranks models by elpd_loo, best first, with paired-difference standard
 * errors against the winner. Every model must score the same observations.
 */
export function compareLoo(models: { name: string; result: LooResult }[]): LooComparison[] {
  if (models.length < 2) throw new Error("compare needs at least two models");
  const n = models[0]?.result.nObservations ?? 0;
  for (const m of models) {
    if (m.result.nObservations !== n) {
      throw new Error(
        `models score different observation counts (${m.name}: ${m.result.nObservations}, expected ${n}); they are not comparable`,
      );
    }
  }
  const ranked = [...models].sort((a, b) => b.result.elpd - a.result.elpd);
  const best = ranked[0] as (typeof ranked)[number];
  return ranked.map((m) => {
    if (m === best) return { ...m, elpdDiff: 0, seDiff: 0 };
    const diffs = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      diffs[i] = (best.result.pointwise.elpd[i] as number) - (m.result.pointwise.elpd[i] as number);
    }
    return { ...m, elpdDiff: -diffs.reduce((a, b) => a + b, 0), seDiff: seOfTotal(diffs) };
  });
}
