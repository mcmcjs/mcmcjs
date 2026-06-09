import type { GraphElement, ModelData, UnifiedModelData } from "./types";

/** Parse a saved DoodleBUGS graph (JSON text) into a UnifiedModelData. */
export function parseUnifiedModel(text: string): UnifiedModelData {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new Error(`invalid graph JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("invalid graph: expected a JSON object");
  }
  const model = parsed as UnifiedModelData;
  if (getElements(model).length === 0) {
    throw new Error("invalid graph: no elements (expected a nodes/edges array)");
  }
  return model;
}

/** The graph elements, tolerating the legacy `graphJSON` alias. */
export function getElements(model: UnifiedModelData): GraphElement[] {
  return model.elements ?? model.graphJSON ?? [];
}

/**
 * The model's data and initial values. Prefers the stringified `dataContent`
 * blob, falling back to legacy inline `data`/`inits`. Missing parts default to
 * empty objects rather than throwing.
 */
export function parseModelData(model: UnifiedModelData): ModelData {
  if (model.dataContent !== undefined) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(model.dataContent);
    } catch (err) {
      throw new Error(
        `invalid dataContent JSON: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    const blob = (parsed ?? {}) as Partial<ModelData>;
    return { data: blob.data ?? {}, inits: blob.inits ?? {} };
  }
  return { data: model.data ?? {}, inits: model.inits ?? {} };
}
