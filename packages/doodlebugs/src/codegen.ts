import { buildTopologicalOrder } from "./topo-sort";
import type { GraphEdge, GraphElement, GraphNode } from "./types";

interface TreeMember {
  id: string;
  type: "node" | "plate";
  children: TreeMember[];
}

/**
 * Generate classic BUGS model code (`model { ... }`) from a DoodleBUGS graph.
 * Ported from the editor's useBugsCodeGenerator so the codegen has one home.
 * Stochastic/observed nodes become `name[idx] ~ dist(params)` (with an optional
 * `<-` data-transform and `C(lower, upper)` censoring); deterministic nodes
 * become `name[idx] <- equation`; plates become `for (i in range) { ... }`;
 * constant nodes emit nothing (they are data, not statements).
 */
export function generateBugsModel(elements: GraphElement[]): string {
  const nodes = elements.filter((el): el is GraphNode => el.type === "node");
  const edges = elements.filter((el): el is GraphEdge => el.type === "edge");
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const nameToNode = new Map(nodes.map((n) => [n.name, n]));

  if (nodes.length === 0) return "model {\n}";

  const sortedNodeIds = buildTopologicalOrder(nodes, edges);

  const treeRoot: TreeMember = { id: "root", type: "plate", children: [] };
  const treeMemberMap = new Map<string, TreeMember>([["root", treeRoot]]);
  for (const node of nodes) {
    treeMemberMap.set(node.id, {
      id: node.id,
      type: node.nodeType === "plate" ? "plate" : "node",
      children: [],
    });
  }
  for (const node of nodes) {
    const parentMember = treeMemberMap.get(node.parent ?? "root");
    const childMember = treeMemberMap.get(node.id);
    if (parentMember && childMember) parentMember.children.push(childMember);
  }

  const formatParam = (raw: string): string => {
    const p = raw.trim();
    if (!p) return p;
    // Already indexed (e.g. foo[i,j]) -> leave as-is.
    if (/\[[^\]]+\]\s*$/.test(p)) return p;
    // Numeric literal or an expression with parentheses -> leave as-is.
    if (/^[+-]?(?:\d+\.?\d*|\d*\.\d+)(?:[eE][+-]?\d+)?$/.test(p) || /[()]/.test(p)) return p;
    const ref = nameToNode.get(p);
    if (ref?.indices && ref.indices.trim() !== "") return `${p}[${ref.indices}]`;
    return p;
  };

  const paramsOf = (node: GraphNode): string =>
    [node.param1, node.param2, node.param3]
      .filter((p): p is string => p !== undefined && p.trim() !== "")
      .map(formatParam)
      .join(", ");

  const generate = (member: TreeMember, indentLevel: number): string[] => {
    const lines: string[] = [];
    const indent = "  ".repeat(indentLevel);

    const sortedChildren = [...member.children].sort((a, b) => {
      // Plates first.
      if (a.type === "plate" && b.type !== "plate") return -1;
      if (b.type === "plate" && a.type !== "plate") return 1;
      // Among nodes: observed/stochastic before deterministic.
      const na = a.type === "node" ? nodeMap.get(a.id) : undefined;
      const nb = b.type === "node" ? nodeMap.get(b.id) : undefined;
      const pa = na?.nodeType === "deterministic" ? 1 : 0;
      const pb = nb?.nodeType === "deterministic" ? 1 : 0;
      if (pa !== pb) return pa - pb;
      // Tiebreaker: topological order.
      return sortedNodeIds.indexOf(a.id) - sortedNodeIds.indexOf(b.id);
    });

    for (const child of sortedChildren) {
      const node = nodeMap.get(child.id);
      if (!node) continue;

      if (child.type === "plate") {
        lines.push(`${indent}for (${node.loopVariable} in ${node.loopRange}) {`);
        lines.push(...generate(child, indentLevel + 1));
        lines.push(`${indent}}`);
        continue;
      }

      const name = node.indices ? `${node.name}[${node.indices}]` : node.name;

      if (node.nodeType === "stochastic" || node.nodeType === "observed") {
        // Optional data-transform line before the stochastic statement.
        if (node.equation?.trim()) lines.push(`${indent}${name} <- ${node.equation}`);

        const cl = node.censorLower?.trim() ?? "";
        const cu = node.censorUpper?.trim() ?? "";
        const censor = cl || cu ? `C(${cl},${cu ? ` ${cu}` : ""})` : "";

        lines.push(`${indent}${name} ~ ${node.distribution}(${paramsOf(node)})${censor}`);
      } else if (node.nodeType === "deterministic" && node.equation) {
        lines.push(`${indent}${name} <- ${node.equation}`);
      }
    }
    return lines;
  };

  return ["model {", ...generate(treeRoot, 1), "}"].join("\n");
}
