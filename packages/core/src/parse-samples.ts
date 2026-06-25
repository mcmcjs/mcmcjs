import { parseArvizJson } from "./parsers/arviz";
import { parseMCMCChainsJson } from "./parsers/mcmcchains";
import { looksLikeTuringCsv, parseTuringCsv } from "./parsers/turing-csv";
import type { Samples } from "./types";

/**
 * Parses a samples file, auto-detecting the format: MCMCChains JSON (has `size`
 * and `value_flat`), ArviZ InferenceData JSON (groups containing `data_vars`),
 * or Turing.jl CSV (wide `iteration,chain`, wide `chain_,draw_`, or long layout).
 */
export function parseSamples(input: string | object): Samples {
  // CSV does not start with a JSON delimiter, so sniff it before JSON.parse.
  if (typeof input === "string") {
    const head = input.trimStart()[0];
    if (head !== "{" && head !== "[" && looksLikeTuringCsv(input)) return parseTuringCsv(input);
  }

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
    "samples: unrecognized format (expected MCMCChains JSON, ArviZ InferenceData JSON, or Turing CSV)",
  );
}
