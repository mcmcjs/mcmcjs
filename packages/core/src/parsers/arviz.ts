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

// Reads a nested array at an index tuple; out-of-bounds or non-array yields NaN.
function readAt(data: unknown, indices: number[]): number {
  let node: unknown = data;
  for (const k of indices) {
    if (!Array.isArray(node) || k >= node.length) return Number.NaN;
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
    const dims = variable.dims;
    // Locate the chain/draw axes by name so any axis order is handled; a variable
    // lacking either axis is skipped (matching the reference parser).
    const chainDim = dims.indexOf("chain");
    const drawDim = dims.indexOf("draw");
    if (chainDim < 0 || drawDim < 0) continue;

    const shape = shapeOf(variable.data);
    const chains = shape[chainDim] ?? 0;
    const draws = shape[drawDim] ?? 0;
    nChains = chains;
    nDraws = draws;

    const extraAxes = dims.map((_, i) => i).filter((i) => i !== chainDim && i !== drawDim);
    const extraShape = extraAxes.map((i) => shape[i] ?? 0);
    for (const extraIdx of productIndices(extraShape)) {
      const key = extraAxes.length > 0 ? `${name}[${extraIdx.join(",")}]` : name;
      const out = new Float64Array(chains * draws);
      for (let c = 0; c < chains; c++) {
        for (let d = 0; d < draws; d++) {
          const fullIdx = new Array<number>(dims.length).fill(0);
          fullIdx[chainDim] = c;
          fullIdx[drawDim] = d;
          extraAxes.forEach((ax, k) => {
            fullIdx[ax] = extraIdx[k] ?? 0;
          });
          out[c * draws + d] = readAt(variable.data, fullIdx);
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
