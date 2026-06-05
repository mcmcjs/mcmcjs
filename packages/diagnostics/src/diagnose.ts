import { computeEssBulk, computeEssTail } from "./ess";
import { computeMCSEMultiChain } from "./mcse";
import { computeRhat } from "./rhat";
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
  };
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
