import { parseSamples, type Samples } from "@mcmcjs/core";
import {
  autocorrData,
  cornerData,
  densityData,
  diagnosticsHeatmapData,
  energyData,
  forestData,
  rankData,
  summaryTableData,
  traceData,
} from "@mcmcjs/plots";
import { subsetChains } from "./runs";

export interface ComputeRequest {
  id: number;
  type: "load" | "compute";
  samplesText?: string;
  op?: string;
  variable?: string;
  cornerMaxVars?: number;
  keep?: boolean[];
}

export interface ComputeResponse {
  id: number;
  data?: unknown;
  error?: string;
}

let full: Samples | null = null;
let subsetKey = "";
let subset: Samples | null = null;

function samplesFor(keep?: boolean[]): Samples {
  if (!full) throw new Error("samples are not loaded");
  const key = (keep ?? []).join(",");
  if (!keep || keep.every(Boolean)) return full;
  if (key !== subsetKey || !subset) {
    subset = subsetChains(full, keep);
    subsetKey = key;
  }
  return subset;
}

function compute(request: ComputeRequest): unknown {
  const samples = samplesFor(request.keep);
  switch (request.op) {
    case "summary":
      return summaryTableData(samples);
    case "heatmap":
      return diagnosticsHeatmapData(samples);
    case "forest":
      return forestData(samples);
    case "energy":
      try {
        return energyData(samples);
      } catch {
        return null;
      }
    case "corner":
      return cornerData([{ samples }], {
        vars: [...samples.variables].slice(0, request.cornerMaxVars ?? 8),
      });
    case "pervar": {
      const variable = request.variable ?? "";
      if (!samples.variables.includes(variable)) return null;
      return {
        trace: traceData(samples, variable),
        density: densityData(samples, variable),
        rank: rankData(samples, variable),
        autocorr: autocorrData(samples, variable),
      };
    }
    default:
      throw new Error(`unknown op ${request.op}`);
  }
}

self.onmessage = (event: MessageEvent<ComputeRequest>) => {
  const request = event.data;
  try {
    if (request.type === "load") {
      full = parseSamples(request.samplesText ?? "");
      subset = null;
      subsetKey = "";
      self.postMessage({
        id: request.id,
        data: {
          variables: [...full.variables],
          nChains: full.nChains,
          nDraws: full.nDraws,
        },
      } satisfies ComputeResponse);
      return;
    }
    self.postMessage({ id: request.id, data: compute(request) } satisfies ComputeResponse);
  } catch (error) {
    self.postMessage({
      id: request.id,
      error: (error as Error).message,
    } satisfies ComputeResponse);
  }
};
