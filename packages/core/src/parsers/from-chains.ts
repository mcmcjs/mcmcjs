import { chainView, type Samples } from "../types";

/**
 * Builds `Samples` from per-chain, per-variable arrays:
 * `{ chainKey: { variable: number[] } }`. Chains are positional in object
 * insertion order; every chain must carry every variable at the same length.
 */
export function fromChainArrays(input: Record<string, Record<string, number[]>>): Samples {
  const chainKeys = Object.keys(input);
  const nChains = chainKeys.length;
  if (nChains === 0) throw new Error("fromChainArrays: no chains");

  const firstChain = input[chainKeys[0] as string] as Record<string, number[]>;
  const variables = Object.keys(firstChain);
  if (variables.length === 0) throw new Error("fromChainArrays: no variables");
  const nDraws = firstChain[variables[0] as string]?.length ?? 0;

  const draws = new Map<string, Float64Array>();
  for (const variable of variables) {
    const flat = new Float64Array(nChains * nDraws);
    chainKeys.forEach((chainKey, c) => {
      const arr = input[chainKey]?.[variable];
      if (!arr)
        throw new Error(`fromChainArrays: chain "${chainKey}" is missing variable "${variable}"`);
      if (arr.length !== nDraws) {
        throw new Error(
          `fromChainArrays: chain "${chainKey}" variable "${variable}" has ${arr.length} draws, expected ${nDraws}`,
        );
      }
      for (let d = 0; d < nDraws; d++) flat[c * nDraws + d] = Number(arr[d]);
    });
    draws.set(variable, flat);
  }

  return { variables, nChains, nDraws, draws, sampleStats: new Map() };
}

/**
 * Inverse of `fromChainArrays`: a chain-major `{ chain_<c>: { variable: number[] } }`
 * object keyed `chain_1 .. chain_N`. Model variables only (sampler stats excluded).
 */
export function toChainArrays(samples: Samples): Record<string, Record<string, number[]>> {
  const out: Record<string, Record<string, number[]>> = {};
  for (let c = 0; c < samples.nChains; c++) {
    const chain: Record<string, number[]> = {};
    for (const variable of samples.variables) {
      chain[variable] = Array.from(chainView(samples, variable, c));
    }
    out[`chain_${c + 1}`] = chain;
  }
  return out;
}
