import type { Samples } from "../types";

interface ArvizVar {
  dims: string[];
  data: unknown;
}
interface ArvizGroup {
  data_vars: Record<string, ArvizVar>;
}
type ArvizJson = Record<string, ArvizGroup | undefined>;

/** Infers the shape (lengths per dimension) of a nested array. */
function shapeOf(data: unknown): number[] {
  const shape: number[] = [];
  let node: unknown = data;
  while (Array.isArray(node)) {
    shape.push(node.length);
    node = node[0];
  }
  return shape;
}

/** Yields every index tuple for the given trailing dimensions. */
function* productIndices(dims: number[]): Generator<number[]> {
  if (dims.length === 0) {
    yield [];
    return;
  }
  const [head, ...rest] = dims;
  for (let i = 0; i < (head ?? 0); i++) {
    for (const tail of productIndices(rest)) yield [i, ...tail];
  }
}

function at(data: unknown, indices: number[]): number {
  let node: unknown = data;
  for (const k of indices) {
    if (!Array.isArray(node)) throw new Error("arviz json: ragged or malformed data array");
    node = node[k];
  }
  return Number(node);
}

function ingest(
  group: ArvizGroup,
  target: Map<string, Float64Array>,
): { nChains: number; nDraws: number } {
  let nChains = 0;
  let nDraws = 0;
  for (const [name, variable] of Object.entries(group.data_vars)) {
    const shape = shapeOf(variable.data);
    if (shape.length < 2) throw new Error(`arviz json: variable ${name} needs chain and draw dims`);
    const chains = shape[0] ?? 0;
    const draws = shape[1] ?? 0;
    const extra = shape.slice(2);
    nChains = chains;
    nDraws = draws;
    for (const idx of productIndices(extra)) {
      const key = idx.length > 0 ? `${name}[${idx.join(",")}]` : name;
      const out = new Float64Array(chains * draws);
      for (let c = 0; c < chains; c++) {
        for (let d = 0; d < draws; d++) {
          out[c * draws + d] = at(variable.data, [c, d, ...idx]);
        }
      }
      target.set(key, out);
    }
  }
  return { nChains, nDraws };
}

export function parseArvizJson(input: string | ArvizJson): Samples {
  const obj: ArvizJson = typeof input === "string" ? (JSON.parse(input) as ArvizJson) : input;
  const posterior = obj.posterior;
  if (!posterior?.data_vars) throw new Error("arviz json: missing posterior.data_vars");

  const draws = new Map<string, Float64Array>();
  const { nChains, nDraws } = ingest(posterior, draws);

  const sampleStats = new Map<string, Float64Array>();
  const stats = obj.sample_stats;
  if (stats?.data_vars) ingest(stats, sampleStats);

  return { variables: [...draws.keys()], nChains, nDraws, draws, sampleStats };
}
