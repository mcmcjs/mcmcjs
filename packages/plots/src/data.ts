import { chainView, type Samples } from "@mcmcjs/core";
import { diagnoseChains, isConverged, quantiles } from "@mcmcjs/diagnostics";
import type { ForestData, ForestRow, TraceData } from "./types";

/** One variable's draws split per chain, as no-copy views over the Samples buffer. */
export function chainsOf(samples: Samples, variable: string): Float64Array[] {
  return Array.from({ length: samples.nChains }, (_, c) => chainView(samples, variable, c));
}

/** Trace data for one variable: each chain's draw sequence plus R-hat and bulk ESS. */
export function traceData(samples: Samples, variable: string): TraceData {
  const chains = chainsOf(samples, variable);
  const d = diagnoseChains(chains);
  return {
    kind: "trace",
    variable,
    nChains: samples.nChains,
    nDraws: samples.nDraws,
    chains: chains.map((c) => Array.from(c)),
    rhat: d.rhat,
    essBulk: d.essBulk,
  };
}

/** Forest data: a point estimate, HDI, and IQR per variable, sharing an x-axis. */
export function forestData(
  samples: Samples,
  opts: { variables?: readonly string[]; hdiProb?: number } = {},
): ForestData {
  const hdiProb = opts.hdiProb ?? 0.94;
  const variables = opts.variables ?? samples.variables;
  const rows: ForestRow[] = variables.map((variable) => {
    const chains = chainsOf(samples, variable);
    const d = diagnoseChains(chains, hdiProb);
    const pooled = samples.draws.get(variable) ?? chainView(samples, variable, 0);
    const q = quantiles(pooled);
    return {
      variable,
      mean: d.mean,
      hdi: d.hdi,
      iqr: [q.q25, q.q75],
      rhat: d.rhat,
      essBulk: d.essBulk,
      converged: isConverged(d),
    };
  });
  return { kind: "forest", hdiProb, rows };
}
