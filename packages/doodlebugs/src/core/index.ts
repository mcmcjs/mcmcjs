/**
 * `@mcmcjs/doodlebugs/core`: the graph domain layer, free of any code generation.
 * The distribution catalog, graph schema/types, validation, and topological ordering
 * that every codegen target builds on. Import this when you only need to parse,
 * validate, or reason about a DoodleBUGS graph.
 */
export { BUGS_FUNCTIONS, DISTRIBUTIONS, type Distribution, getDistribution } from "./catalog";
export { getElements, parseModelData, parseUnifiedModel } from "./model";
export {
  GraphEdgeSchema,
  GraphElementSchema,
  GraphNodeSchema,
  graphJsonSchema,
  UnifiedModelDataSchema,
} from "./schema";
export { buildTopologicalOrder } from "./topo-sort";
export type {
  GraphEdge,
  GraphElement,
  GraphNode,
  ModelData,
  NodeType,
  UnifiedModelData,
} from "./types";
export { type ValidationIssue, validateGraph } from "./validate";
