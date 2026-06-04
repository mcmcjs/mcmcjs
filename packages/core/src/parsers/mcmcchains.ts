import type { Samples } from "../types";

/** The JSON shape produced by `JSON.lower` on an `MCMCChains.Chains` object. */
export interface MCMCChainsJson {
  /** `[iterations, parameters, chains]`. */
  size: [number, number, number];
  /** Flat values, indexed `iteration + parameter * iterations + chain * iterations * parameters`. */
  value_flat: (number | null)[];
  parameters: string[];
  iterations?: number[];
  chains?: number[];
  name_map?: { parameters?: string[]; internals?: string[] };
  info?: unknown;
}

export function parseMCMCChainsJson(input: string | MCMCChainsJson): Samples {
  const obj: MCMCChainsJson =
    typeof input === "string" ? (JSON.parse(input) as MCMCChainsJson) : input;
  const [nIter, nParams, nChains] = obj.size;
  const flat = obj.value_flat;
  const expected = nIter * nParams * nChains;
  if (flat.length !== expected) {
    throw new Error(`mcmcchains json: value_flat length ${flat.length} != ${expected}`);
  }

  const internals = new Set(obj.name_map?.internals ?? []);
  const draws = new Map<string, Float64Array>();
  const sampleStats = new Map<string, Float64Array>();

  for (let p = 0; p < nParams; p++) {
    const name = obj.parameters[p];
    if (name == null) throw new Error(`mcmcchains json: missing parameter name at index ${p}`);
    const out = new Float64Array(nChains * nIter);
    for (let c = 0; c < nChains; c++) {
      for (let i = 0; i < nIter; i++) {
        out[c * nIter + i] = Number(flat[i + p * nIter + c * nIter * nParams]);
      }
    }
    (internals.has(name) ? sampleStats : draws).set(name, out);
  }

  return { variables: [...draws.keys()], nChains, nDraws: nIter, draws, sampleStats };
}

/** Serializes a `Samples` object back to the MCMCChains JSON shape (lossless round-trip). */
export function toMCMCChainsJson(samples: Samples): MCMCChainsJson {
  const parameters = [...samples.variables, ...samples.sampleStats.keys()];
  const nIter = samples.nDraws;
  const nParams = parameters.length;
  const nChains = samples.nChains;
  const flat: number[] = new Array<number>(nIter * nParams * nChains).fill(0);

  parameters.forEach((name, p) => {
    const arr = samples.draws.get(name) ?? samples.sampleStats.get(name);
    if (!arr) throw new Error(`unknown variable: ${name}`);
    for (let c = 0; c < nChains; c++) {
      for (let i = 0; i < nIter; i++) {
        flat[i + p * nIter + c * nIter * nParams] = arr[c * nIter + i] ?? 0;
      }
    }
  });

  return {
    size: [nIter, nParams, nChains],
    value_flat: flat,
    iterations: Array.from({ length: nIter }, (_, i) => i + 1),
    parameters,
    chains: Array.from({ length: nChains }, (_, c) => c + 1),
    name_map: { parameters: [...samples.variables], internals: [...samples.sampleStats.keys()] },
    info: {},
  };
}
