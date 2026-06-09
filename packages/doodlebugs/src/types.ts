// The DoodleBUGS graph data model, ported from the editor's src/types so this
// package can be the shared source of truth for graph -> model codegen.

export type NodeType = "stochastic" | "deterministic" | "constant" | "observed" | "plate";

export interface GraphNode {
  id: string;
  name: string;
  type: "node";
  nodeType: NodeType;
  position?: { x: number; y: number };
  /** id of the enclosing plate node (loop membership); plates nest via their own parent. */
  parent?: string;
  /** BUGS distribution name for stochastic/observed nodes, e.g. "dnorm". */
  distribution?: string;
  /** RHS for a deterministic node, or an optional data-transform on a stochastic/observed node. */
  equation?: string;
  /** true => the node's value is supplied in the data section. */
  observed?: boolean;
  /** subscript expression, e.g. "i" or "i,j". */
  indices?: string;
  /** plate only: the loop index symbol, e.g. "i". */
  loopVariable?: string;
  /** plate only: the loop range, e.g. "1:N". */
  loopRange?: string;
  /** positional distribution parameters. */
  param1?: string;
  param2?: string;
  param3?: string;
  /** BUGS C(lower, upper) censoring bounds. */
  censorLower?: string;
  censorUpper?: string;
}

export interface GraphEdge {
  id: string;
  name?: string;
  type: "edge";
  /** id of the parent/dependency node. */
  source: string;
  /** id of the dependent node. */
  target: string;
  relationshipType?: "stochastic" | "deterministic";
}

export type GraphElement = GraphNode | GraphEdge;

/** The parsed contents of a graph's `dataContent` blob. */
export interface ModelData {
  data: Record<string, unknown>;
  inits: Record<string, unknown>;
}

/** The portable, exported shape of a saved DoodleBUGS graph. */
export interface UnifiedModelData {
  name: string;
  /** the graph: nodes and edges in one flat array. */
  elements?: GraphElement[];
  /** a JSON-stringified `{ "data": {...}, "inits": {...} }`. */
  dataContent?: string;
  /** legacy alias for `elements`. */
  graphJSON?: GraphElement[];
  /** legacy inline data/inits (superseded by `dataContent`). */
  data?: Record<string, unknown>;
  inits?: Record<string, unknown>;
  /** export schema version (1). */
  version?: number;
}
