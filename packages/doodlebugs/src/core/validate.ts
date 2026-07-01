import { BUGS_FUNCTIONS, getDistribution } from "./catalog";
import type { GraphEdge, GraphElement, GraphNode } from "./types";

export interface ValidationIssue {
  nodeId: string;
  field: string;
  message: string;
}

function paramValues(node: GraphNode): string[] {
  return [node.param1, node.param2, node.param3].filter(
    (p): p is string => p !== undefined && String(p).trim() !== "",
  );
}

// Loop variables visible to a node: the loopVariable of every enclosing plate.
function ancestorLoopVars(node: GraphNode, nodeMap: Map<string, GraphNode>): Set<string> {
  const vars = new Set<string>();
  const visited = new Set<string>([node.id]);
  let current: GraphNode | undefined = node;
  while (current?.parent && !visited.has(current.parent)) {
    visited.add(current.parent);
    const parent = nodeMap.get(current.parent);
    if (parent?.nodeType === "plate" && parent.loopVariable) vars.add(parent.loopVariable);
    current = parent;
  }
  return vars;
}

/**
 * Validate a DoodleBUGS graph against the model data, returning one issue per
 * problem. Ported from the editor's graph validator: distribution parameter
 * counts (an input counts when it arrives by edge or as a non-node literal),
 * deterministic equations referencing only parents, data, or loop indices,
 * observed nodes backed by data, and BUGS variable-name validity.
 */
export function validateGraph(
  elements: GraphElement[],
  data: Record<string, unknown> = {},
): ValidationIssue[] {
  const nodes = elements.filter((el): el is GraphNode => el.type === "node");
  const edges = elements.filter((el): el is GraphEdge => el.type === "edge");
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const dataKeys = new Set(Object.keys(data));
  const nodeNames = new Set(nodes.map((n) => n.name));

  const issues: ValidationIssue[] = [];

  for (const node of nodes) {
    if (node.nodeType === "stochastic" || node.nodeType === "observed") {
      const dist = getDistribution(node.distribution ?? "");
      if (dist) {
        const parentEdges = edges.filter((e) => e.target === node.id).length;
        const literal = paramValues(node);
        const linked = literal.filter((p) => {
          const baseName = (p.split("[")[0] as string).trim();
          return nodeNames.has(baseName);
        });
        const provided = parentEdges + (literal.length - linked.length);
        if (provided !== dist.paramCount) {
          issues.push({
            nodeId: node.id,
            field: "distribution",
            message: `Invalid number of inputs. ${dist.label} expects ${dist.paramCount}, but found ${provided}.`,
          });
        }
      }
    }

    if (node.nodeType === "deterministic") {
      if (!node.equation?.trim()) {
        issues.push({
          nodeId: node.id,
          field: "equation",
          message: "Deterministic node must have an equation.",
        });
      } else {
        const loopVars = ancestorLoopVars(node, nodeMap);
        const parentNames = new Set<string>();
        for (const e of edges) {
          if (e.target === node.id) {
            const source = nodeMap.get(e.source);
            if (source) parentNames.add(source.name);
          }
        }
        const identifiers = new Set(node.equation.match(/[a-zA-Z_][a-zA-Z0-9_.]*/g) ?? []);
        for (const identifier of identifiers) {
          if (BUGS_FUNCTIONS.has(identifier)) continue;
          const base = identifier.split("[")[0] as string;
          if (!parentNames.has(base) && !loopVars.has(base) && !dataKeys.has(base)) {
            issues.push({
              nodeId: node.id,
              field: "equation",
              message: `Variable '${base}' in equation is not a parent, data variable, or an available loop index.`,
            });
          }
        }
      }
    }

    if (node.observed && !dataKeys.has(node.name)) {
      issues.push({
        nodeId: node.id,
        field: "name",
        message: `Node is marked as observed, but no data found for '${node.name}'.`,
      });
    }

    // Plates are exempt: their name is only a UI label.
    if (node.nodeType !== "plate") {
      const baseName = (node.name.split("[")[0] as string).trim();
      if (!/^[a-zA-Z][a-zA-Z0-9.]*$/.test(baseName)) {
        issues.push({
          nodeId: node.id,
          field: "name",
          message: `Base name '${baseName}' is not a valid BUGS variable name.`,
        });
      }
    }
  }

  return issues;
}
