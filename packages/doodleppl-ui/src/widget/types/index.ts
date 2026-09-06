export type NodeType = 'stochastic' | 'deterministic' | 'constant' | 'observed' | 'plate'

export type PaletteItemType = NodeType | 'add-edge'

export interface ValidationError {
  field: string
  message: string
}

// This interface is now a superset of all possible properties defined in nodeDefinitions.ts.
// All properties specific to a node type are optional.
export interface GraphNode {
  id: string
  name: string
  type: 'node'
  nodeType: NodeType
  position: { x: number; y: number }
  parent?: string

  // Properties from definitions
  distribution?: string
  equation?: string
  observed?: boolean
  indices?: string
  loopVariable?: string
  loopRange?: string

  // Distribution parameters
  param1?: string
  param2?: string
  param3?: string

  // Censoring bounds (BUGS C(lower, upper) syntax)
  censorLower?: string
  censorUpper?: string

  // Index signature to allow dynamic property access
  [key: string]: string | number | boolean | null | undefined | { x: number; y: number } | string[]
}

export interface GraphEdge {
  id: string
  name?: string
  type: 'edge'
  source: string
  target: string
  relationshipType?: 'stochastic' | 'deterministic'
}

export type GraphElement = GraphNode | GraphEdge

export interface UnifiedModelData {
  name: string
  elements?: GraphElement[]
  dataContent?: string
  // Legacy support fields
  graphJSON?: GraphElement[]
  data?: Record<string, unknown>
  inits?: Record<string, unknown>
  /** The language the model was imported from; decides the variable-name rules. */
  language?: ModelLanguage
  /** A layout to run when the document opens (`dagre`, `klay`, `fcose`, `cola`). */
  autoLayout?: string
  /** The editor's panel geometry (code and data panel placement), restored on open. */
  layout?: Record<string, unknown>
}

export type ModelLanguage = 'bugs' | 'stan'

export interface ExampleModel {
  name: string
  graphJSON: GraphElement[]
}

export interface ModelData {
  data: { [key: string]: string | number | boolean | null | undefined }
  inits: { [key: string]: string | number | boolean | null | undefined }
}

declare module 'cytoscape' {
  interface Core {
    /**
     * Export the graph as SVG.
     * Provided by cytoscape-svg extension.
     */
    svg(options?: {
      scale?: number
      full?: boolean
      bg?: string
      maxWidth?: number
      maxHeight?: number
      [key: string]: unknown
    }): string
  }
}
