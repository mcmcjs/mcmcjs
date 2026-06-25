import { extent, niceDomain } from "@mcmcjs/charts";
import { chainView, type Samples } from "@mcmcjs/core";
import { autocorr, diagnoseChains, isConverged, quantiles, rhat, stdev } from "@mcmcjs/diagnostics";
import type {
  AutocorrData,
  CumulativeMeanData,
  DensityData,
  EcdfData,
  EnergyData,
  ForestData,
  ForestRow,
  HistogramData,
  PairData,
  RankData,
  RunningRhatData,
  TraceData,
} from "./types";

const INV_SQRT_2PI = 1 / Math.sqrt(2 * Math.PI);

/** Silverman rule-of-thumb bandwidth; 0 when the sample has no spread. */
function bandwidth(chain: Float64Array): number {
  const n = chain.length;
  if (n < 2) return 0;
  const sd = stdev(chain);
  const q = quantiles(chain);
  const iqr = q.q75 - q.q25;
  const sigma = iqr > 0 ? Math.min(sd, iqr / 1.349) : sd;
  return sigma > 0 ? 1.06 * sigma * n ** (-1 / 5) : 0;
}

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

/** Kernel-density data for one variable: a Gaussian KDE curve per chain on a shared grid. */
export function densityData(
  samples: Samples,
  variable: string,
  opts: { gridSize?: number } = {},
): DensityData {
  const gridSize = Math.max(2, opts.gridSize ?? 256);
  const chains = chainsOf(samples, variable);
  const pooled = samples.draws.get(variable) ?? chainView(samples, variable, 0);
  const [lo, hi] = niceDomain(...extent(pooled));
  const step = (hi - lo) / (gridSize - 1);
  const x = Array.from({ length: gridSize }, (_, k) => lo + k * step);

  const curves = chains.map((chain) => {
    const h = bandwidth(chain);
    if (h <= 0) return new Array<number>(gridSize).fill(0);
    const norm = 1 / (chain.length * h);
    return x.map((g) => {
      let sum = 0;
      for (const xi of chain) {
        const z = (g - xi) / h;
        sum += Math.exp(-0.5 * z * z);
      }
      return sum * norm * INV_SQRT_2PI;
    });
  });

  return { kind: "density", variable, nChains: samples.nChains, x, chains: curves };
}

/** Pooled histogram for one variable; bin count via Freedman-Diaconis unless `bins` is given. */
export function histogramData(
  samples: Samples,
  variable: string,
  opts: { bins?: number } = {},
): HistogramData {
  const pooled = samples.draws.get(variable) ?? chainView(samples, variable, 0);
  const values = Array.from(pooled).filter(Number.isFinite);
  const total = values.length;
  const [lo, hi] = extent(values);

  let bins = opts.bins;
  if (!bins || bins < 1) {
    const q = quantiles(pooled);
    const iqr = q.q75 - q.q25;
    const fd = iqr > 0 && total > 0 ? 2 * iqr * total ** (-1 / 3) : 0;
    bins = fd > 0 ? Math.ceil((hi - lo) / fd) : Math.ceil(Math.sqrt(Math.max(1, total)));
    bins = Math.max(1, Math.min(120, bins));
  }

  const width = hi > lo ? (hi - lo) / bins : 1;
  const counts = new Array<number>(bins).fill(0);
  for (const v of values) {
    const b = Math.min(bins - 1, Math.max(0, Math.floor((v - lo) / width)));
    counts[b] = (counts[b] ?? 0) + 1;
  }
  const binEdges = Array.from({ length: bins + 1 }, (_, i) => lo + i * width);
  return { kind: "histogram", variable, binEdges, counts, total };
}

/** Rank plot data: per-chain counts of pooled average-ranks over `bins` bins. */
export function rankData(
  samples: Samples,
  variable: string,
  opts: { bins?: number } = {},
): RankData {
  const bins = Math.max(1, opts.bins ?? 20);
  const { nChains, nDraws } = samples;
  const pooled = samples.draws.get(variable) ?? chainView(samples, variable, 0);
  const n = pooled.length;

  // Average ranks (1-based); tied values share the mean of their rank block.
  const order = Array.from({ length: n }, (_, i) => i).sort(
    (a, b) => (pooled[a] as number) - (pooled[b] as number),
  );
  const ranks = new Float64Array(n);
  let i = 0;
  while (i < n) {
    let j = i;
    while (j + 1 < n && pooled[order[j + 1] as number] === pooled[order[i] as number]) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) ranks[order[k] as number] = avg;
    i = j + 1;
  }

  const counts = Array.from({ length: nChains }, () => new Array<number>(bins).fill(0));
  for (let idx = 0; idx < n; idx++) {
    const chain = Math.min(nChains - 1, Math.floor(idx / nDraws));
    const b = Math.min(bins - 1, Math.floor((((ranks[idx] as number) - 1) / n) * bins));
    const row = counts[chain] as number[];
    row[b] = (row[b] ?? 0) + 1;
  }
  return { kind: "rank", variable, nChains, bins, counts, expected: nDraws / bins };
}

/** Autocorrelation data: the ACF (lag 0..maxLag) of each chain. */
export function autocorrData(
  samples: Samples,
  variable: string,
  opts: { maxLag?: number } = {},
): AutocorrData {
  const maxLag = Math.max(1, opts.maxLag ?? 40);
  const chains = chainsOf(samples, variable).map((c) => autocorr(c, maxLag));
  const longest = Math.max(0, ...chains.map((a) => a.length));
  const lags = Array.from({ length: longest }, (_, k) => k);
  return { kind: "autocorr", variable, nChains: samples.nChains, maxLag, lags, chains };
}

/** Per-draw divergence flags (chain-major), from the sampler stats; all false when absent. */
function divergingFlags(samples: Samples): boolean[] {
  const series = samples.sampleStats.get("numerical_error") ?? samples.sampleStats.get("diverging");
  const n = samples.nChains * samples.nDraws;
  if (!series) return new Array<boolean>(n).fill(false);
  return Array.from({ length: n }, (_, i) => (series[i] ?? 0) !== 0);
}

/** Pair plot data: pooled joint draws of two variables, labeled by chain and divergence. */
export function pairData(samples: Samples, xVar: string, yVar: string): PairData {
  const xs = samples.draws.get(xVar) ?? chainView(samples, xVar, 0);
  const ys = samples.draws.get(yVar) ?? chainView(samples, yVar, 0);
  const div = divergingFlags(samples);
  const n = Math.min(xs.length, ys.length);
  const x: number[] = [];
  const y: number[] = [];
  const chain: number[] = [];
  const diverging: boolean[] = [];
  for (let i = 0; i < n; i++) {
    x.push(xs[i] as number);
    y.push(ys[i] as number);
    chain.push(Math.floor(i / samples.nDraws));
    diverging.push(div[i] ?? false);
  }
  return { kind: "pair", xVar, yVar, nChains: samples.nChains, x, y, chain, diverging };
}

/**
 * Energy diagnostic data (HMC/NUTS): the centered marginal-energy distribution and the
 * energy-transition distribution on shared bins, plus per-chain E-BFMI. Throws when the
 * sampler did not record an energy statistic.
 */
export function energyData(samples: Samples, opts: { bins?: number } = {}): EnergyData {
  const energy = samples.sampleStats.get("hamiltonian_energy") ?? samples.sampleStats.get("energy");
  if (!energy) {
    throw new Error("energy plot needs the 'hamiltonian_energy' sampler statistic");
  }
  const { nChains, nDraws } = samples;
  let total = 0;
  for (const v of energy) total += v;
  const mean = total / energy.length;

  const marginalVals: number[] = [];
  const transitionVals: number[] = [];
  const bfmi: number[] = [];
  for (let c = 0; c < nChains; c++) {
    let chainSum = 0;
    for (let i = 0; i < nDraws; i++) chainSum += energy[c * nDraws + i] as number;
    const chainMean = chainSum / nDraws;
    let num = 0;
    let den = 0;
    for (let i = 0; i < nDraws; i++) {
      const e = energy[c * nDraws + i] as number;
      marginalVals.push(e - mean);
      den += (e - chainMean) ** 2;
      if (i > 0) {
        const d = e - (energy[c * nDraws + i - 1] as number);
        transitionVals.push(d);
        num += d * d;
      }
    }
    bfmi.push(den > 0 ? num / den : Number.NaN);
  }

  const bins = Math.max(1, opts.bins ?? 30);
  const [lo, hi] = extent([...marginalVals, ...transitionVals]);
  const width = hi > lo ? (hi - lo) / bins : 1;
  const edges = Array.from({ length: bins + 1 }, (_, i) => lo + i * width);
  const binOf = (vals: number[]): number[] => {
    const counts = new Array<number>(bins).fill(0);
    for (const v of vals) {
      const b = Math.min(bins - 1, Math.max(0, Math.floor((v - lo) / width)));
      counts[b] = (counts[b] ?? 0) + 1;
    }
    return counts;
  };
  return {
    kind: "energy",
    edges,
    marginal: binOf(marginalVals),
    transition: binOf(transitionVals),
    bfmi,
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

/** Empirical CDF per chain: sorted draws with cumulative probability `(i+1)/n`. */
export function ecdfData(samples: Samples, variable: string): EcdfData {
  const series = chainsOf(samples, variable).map((c, chain) => {
    const sorted = Array.from(c).sort((a, b) => a - b);
    const n = sorted.length;
    const y = sorted.map((_, i) => (i + 1) / n);
    return { chain, x: sorted, y };
  });
  return { kind: "ecdf", variable, nChains: samples.nChains, series };
}

/** Running mean per chain over shared 1-based iterations. */
export function cumulativeMeanData(samples: Samples, variable: string): CumulativeMeanData {
  const chains = chainsOf(samples, variable);
  const maxLen = Math.max(0, ...chains.map((c) => c.length));
  const iterations = Array.from({ length: maxLen }, (_, i) => i + 1);
  const out = chains.map((c) => {
    const v = new Array<number>(c.length);
    let sum = 0;
    for (let j = 0; j < c.length; j++) {
      sum += c[j] ?? 0;
      v[j] = sum / (j + 1);
    }
    return v;
  });
  return { kind: "cumulative-mean", variable, nChains: samples.nChains, iterations, chains: out };
}

/** Basic split-R-hat over an increasing prefix of draws (needs >= 2 chains, >= 6 draws). */
export function runningRhatData(samples: Samples, variable: string): RunningRhatData {
  const nChains = samples.nChains;
  const chains = chainsOf(samples, variable).filter((c) => c.length > 0);
  if (chains.length < 2) {
    return { kind: "running-rhat", variable, nChains, iterations: [], rhat: [] };
  }
  const minLen = Math.min(...chains.map((c) => c.length));
  const step = Math.max(1, Math.floor(minLen / 200));
  const startAt = Math.max(6, step);
  const iterations: number[] = [];
  const rhats: number[] = [];
  for (let n = startAt; n <= minLen; n += step) {
    const r = rhat(
      chains.map((c) => c.slice(0, n)),
      "basic",
    );
    if (Number.isFinite(r)) {
      iterations.push(n);
      rhats.push(r);
    }
  }
  return { kind: "running-rhat", variable, nChains, iterations, rhat: rhats };
}
