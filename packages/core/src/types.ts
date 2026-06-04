/**
 * Posterior draws for a set of variables across chains, plus optional sampler
 * statistics. This is the in-memory representation every stage operates on,
 * independent of the on-disk samples-file format it was parsed from.
 */
export interface Samples {
  /** Variable names, scalarized — multidimensional entries use `name[i,j]`. */
  readonly variables: readonly string[];
  readonly nChains: number;
  readonly nDraws: number;
  /**
   * Draw values per variable, chain-major: `draws.get(v)![chain * nDraws + draw]`.
   * Each array has length `nChains * nDraws`.
   */
  readonly draws: ReadonlyMap<string, Float64Array>;
  /** Per-draw sampler statistics (e.g. `lp`, `diverging`), same layout as `draws`. */
  readonly sampleStats: ReadonlyMap<string, Float64Array>;
}

/** Returns one variable's draws for one chain as a view (no copy). */
export function chainView(samples: Samples, variable: string, chain: number): Float64Array {
  const all = samples.draws.get(variable) ?? samples.sampleStats.get(variable);
  if (!all) throw new Error(`unknown variable: ${variable}`);
  if (chain < 0 || chain >= samples.nChains) throw new Error(`chain ${chain} out of range`);
  const start = chain * samples.nDraws;
  return all.subarray(start, start + samples.nDraws);
}
