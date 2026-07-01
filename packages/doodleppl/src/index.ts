/**
 * `@mcmcjs/doodleppl`: turn a DoodlePPL graph into probabilistic model code.
 * The root entry re-exports the graph domain layer (`./core`) plus the default BUGS
 * target (model + JuliaBUGS run-script) for backward compatibility. The Stan target
 * lives on its own subpath: `@mcmcjs/doodleppl/stan`.
 */

export { generateBugsModel } from "./codegen/bugs";
export {
  generateStandaloneScript,
  type StandaloneGeneratorSettings,
  type StandaloneScriptInput,
} from "./codegen/bugs-script";
export {
  BUGS_FUNCTIONS,
  buildTopologicalOrder,
  DISTRIBUTIONS,
  type Distribution,
  type GraphEdge,
  GraphEdgeSchema,
  type GraphElement,
  GraphElementSchema,
  type GraphNode,
  GraphNodeSchema,
  getDistribution,
  getElements,
  graphJsonSchema,
  type ModelData,
  type NodeType,
  parseModelData,
  parseUnifiedModel,
  type UnifiedModelData,
  UnifiedModelDataSchema,
  type ValidationIssue,
  validateGraph,
} from "./core";
