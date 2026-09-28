import type { GraphEdge, GraphNode } from "./types";

/**
 * Topological sort (Kahn's algorithm) over graph nodes. Returns node ids in
 * dependency order (parents before children). A returned array shorter than
 * `nodes` means the graph has a cycle (the nodes in a cycle are dropped).
 */
export function buildTopologicalOrder(nodes: GraphNode[], edges: GraphEdge[]): string[] {
  const inDegree: Record<string, number> = {};
  const adjacency: Record<string, string[]> = {};
  for (const node of nodes) {
    inDegree[node.id] = 0;
    adjacency[node.id] = [];
  }
  for (const edge of edges) {
    const out = adjacency[edge.source];
    const deg = inDegree[edge.target];
    if (out && deg !== undefined) {
      out.push(edge.target);
      inDegree[edge.target] = deg + 1;
    }
  }
  const queue = nodes.filter((n) => inDegree[n.id] === 0).map((n) => n.id);
  const sorted: string[] = [];
  while (queue.length > 0) {
    const id = queue.shift() as string;
    sorted.push(id);
    for (const child of adjacency[id] ?? []) {
      const deg = inDegree[child];
      if (deg !== undefined) {
        inDegree[child] = deg - 1;
        if (deg - 1 === 0) queue.push(child);
      }
    }
  }
  return sorted;
}

/**
 * A topological order for emitting statements, in which each plate stands for
 * everything inside it, nested plates included: a plate sorts after the nodes
 * its members read and before the nodes that read them. An edge constrains the
 * two siblings, children of the same plate or of the top level, that its ends
 * belong to. A returned array shorter than `nodes` means two siblings depend on
 * each other, which no single pass over a plate can honour.
 */
export function buildPlateAwareOrder(nodes: GraphNode[], edges: GraphEdge[]): string[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  // The plates around a node, outermost first, then the node itself.
  const nesting = (id: string): string[] => {
    const chain: string[] = [];
    for (let n = byId.get(id); n; n = n.parent ? byId.get(n.parent) : undefined) {
      chain.unshift(n.id);
    }
    return chain;
  };
  const lifted: GraphEdge[] = [];
  for (const edge of edges) {
    const from = nesting(edge.source);
    const to = nesting(edge.target);
    let depth = 0;
    while (depth < from.length && depth < to.length && from[depth] === to[depth]) depth++;
    const source = from[depth];
    const target = to[depth];
    if (source !== undefined && target !== undefined) lifted.push({ ...edge, source, target });
  }
  return buildTopologicalOrder(nodes, lifted);
}
