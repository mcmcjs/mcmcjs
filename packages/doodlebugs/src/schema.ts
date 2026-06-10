import { z } from "zod";

// Runtime validation for the DoodleBUGS graph format. Loose objects: saved
// graphs carry editor-only keys (positions, styles) that consumers ignore, and
// the format predates this schema, so unknown keys must not be rejected. The
// JSON Schema artifact published as graph.schema.json is generated from
// UnifiedModelDataSchema at build time.

const PositionSchema = z.looseObject({ x: z.number(), y: z.number() });

export const GraphNodeSchema = z.looseObject({
  id: z.string().min(1),
  name: z.string(),
  type: z.literal("node"),
  nodeType: z.enum(["stochastic", "deterministic", "constant", "observed", "plate"]),
  position: PositionSchema.optional(),
  parent: z.string().optional(),
  distribution: z.string().optional(),
  equation: z.string().optional(),
  observed: z.boolean().optional(),
  indices: z.string().optional(),
  loopVariable: z.string().optional(),
  loopRange: z.string().optional(),
  param1: z.string().optional(),
  param2: z.string().optional(),
  param3: z.string().optional(),
  censorLower: z.string().optional(),
  censorUpper: z.string().optional(),
});

export const GraphEdgeSchema = z.looseObject({
  id: z.string().min(1),
  name: z.string().optional(),
  type: z.literal("edge"),
  source: z.string().min(1),
  target: z.string().min(1),
  relationshipType: z.enum(["stochastic", "deterministic"]).optional(),
});

export const GraphElementSchema = z.discriminatedUnion("type", [GraphNodeSchema, GraphEdgeSchema]);

export const UnifiedModelDataSchema = z.looseObject({
  name: z.string(),
  elements: z.array(GraphElementSchema).optional(),
  /** a JSON-stringified `{ "data": {...}, "inits": {...} }`. */
  dataContent: z.string().optional(),
  /** legacy alias for `elements`. */
  graphJSON: z.array(GraphElementSchema).optional(),
  data: z.record(z.string(), z.unknown()).optional(),
  inits: z.record(z.string(), z.unknown()).optional(),
  version: z.number().optional(),
});

/** The graph format as a JSON Schema document. */
export function graphJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(UnifiedModelDataSchema) as Record<string, unknown>;
}
