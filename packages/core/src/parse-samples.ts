import { parseArvizJson } from "./parsers/arviz";
import { parseMCMCChainsJson } from "./parsers/mcmcchains";
import type { Samples } from "./types";

/**
 * Parses a samples file, auto-detecting the format: MCMCChains JSON (has `size`
 * and `value_flat`) or ArviZ InferenceData JSON (groups containing `data_vars`).
 */
export function parseSamples(input: string | object): Samples {
  const obj: unknown = typeof input === "string" ? JSON.parse(input) : input;
  if (obj === null || typeof obj !== "object") {
    throw new Error("samples: expected a JSON object");
  }
  const record = obj as Record<string, unknown>;

  if ("value_flat" in record && "size" in record) {
    return parseMCMCChainsJson(obj as Parameters<typeof parseMCMCChainsJson>[0]);
  }

  const looksLikeArviz = Object.values(record).some(
    (group) => group !== null && typeof group === "object" && "data_vars" in group,
  );
  if (looksLikeArviz) {
    return parseArvizJson(obj as Parameters<typeof parseArvizJson>[0]);
  }

  throw new Error(
    "samples: unrecognized format (expected MCMCChains JSON or ArviZ InferenceData JSON)",
  );
}
