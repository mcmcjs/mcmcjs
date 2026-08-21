import { computeEssBulk, computeEssTail } from "./ess";
import { computeMCSEMultiChain } from "./mcse";
import { _isFiniteAndVaries, _splitChains, computeRhat } from "./rhat";
import { computeHDI, computeMean, computeStdev } from "./summary";

/** The standard convergence diagnostics for a single variable. */
export interface VariableDiagnostics {
  mean: number;
  std: number;
  /** Rank-normalized split-R-hat (max of bulk and tail). */
  rhat: number;
  essBulk: number;
  essTail: number;
  /** Monte Carlo standard error of the posterior mean. */
  mcseMean: number;
  /** Highest-density interval `[lower, upper]`. */
  hdi: [number, number];
  /**
   * Whether the draws themselves support an R-hat: every (split) chain holds
   * more than one distinct finite value. False means the variable sat still,
   * which is why R-hat and ESS came back undefined.
   */
  varies: boolean;
}

export interface ConvergenceThresholds {
  /** Maximum acceptable R-hat (Vehtari et al. 2021 recommend < 1.01). */
  rhatMax: number;
  /** Minimum acceptable bulk- and tail-ESS. */
  essMin: number;
}

export const DEFAULT_THRESHOLDS: ConvergenceThresholds = { rhatMax: 1.01, essMin: 400 };

/** Computes the standard diagnostics for one variable, given its chains. */
export function diagnoseChains(chains: Float64Array[], credMass = 0.94): VariableDiagnostics {
  const pooled = concat(chains);
  return {
    mean: computeMean(pooled),
    std: computeStdev(pooled),
    rhat: computeRhat(chains, "rank"),
    essBulk: computeEssBulk(chains),
    essTail: computeEssTail(chains),
    mcseMean: computeMCSEMultiChain(chains),
    hdi: computeHDI(pooled, credMass),
    // The same precondition computeRhat applies, so `varies` says whether the
    // draws could support an R-hat, independently of how many chains there are.
    varies: _isFiniteAndVaries(_splitChains(chains)),
  };
}

/**
 * Whether a variable's diagnostics are undefined because it does not vary, as
 * opposed to because its draws are unusable. R-hat and ESS are NaN as soon as
 * any one chain is effectively constant (`_isFiniteAndVaries`, following Stan),
 * so a recovered discrete latent that sits on one value in one chain and moves
 * once in another lands here too, not only an everywhere-constant one. Such a
 * variable carries no evidence either way about convergence.
 *
 * This asks the draws, not the R-hat: R-hat is also undefined for a single
 * chain, and a lone well-mixed chain has not stood still. The mean and standard
 * deviation separate the remaining case, a non-finite draw, which poisons them
 * while degeneracy leaves them perfectly finite.
 */
export function isDegenerate(d: VariableDiagnostics): boolean {
  return Number.isFinite(d.mean) && Number.isFinite(d.std) && !d.varies;
}

/** Whether a variable's diagnostics clear the convergence thresholds. */
export function isConverged(
  d: VariableDiagnostics,
  thresholds: ConvergenceThresholds = DEFAULT_THRESHOLDS,
): boolean {
  return (
    Number.isFinite(d.rhat) &&
    d.rhat <= thresholds.rhatMax &&
    Number.isFinite(d.essBulk) &&
    d.essBulk >= thresholds.essMin &&
    Number.isFinite(d.essTail) &&
    d.essTail >= thresholds.essMin
  );
}

/** Counts divergent draws in a 0/1 sampler-stat series (e.g. `numerical_error`). */
export function countDivergences(series: Float64Array): number {
  let count = 0;
  for (const value of series) if (value > 0) count += 1;
  return count;
}

function concat(chains: Float64Array[]): Float64Array {
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
