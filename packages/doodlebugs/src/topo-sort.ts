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
