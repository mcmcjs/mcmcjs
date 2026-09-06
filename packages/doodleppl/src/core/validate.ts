import { BUGS_FUNCTIONS, getDistribution } from "./catalog";
import type { GraphEdge, GraphElement, GraphNode, ModelLanguage } from "./types";

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

/** What an index expression covers: one element, a plate's range, or unknown. */
type IndexCoverage =
  | { kind: "literal"; value: number }
  | { kind: "range"; lo: string; hi: string }
  | { kind: "unknown" };

function plateRanges(nodes: GraphNode[]): Map<string, { lo: string; hi: string }> {
  const ranges = new Map<string, { lo: string; hi: string }>();
  for (const n of nodes) {
    if (n.nodeType !== "plate") continue;
    const parts = (n.loopRange || "1:N").split(":").map((s) => s.trim());
    if (parts.length === 2) {
      ranges.set(n.loopVariable || "i", { lo: parts[0] as string, hi: parts[1] as string });
    }
  }
  return ranges;
}

/**
 * The loop ranges in force for one node: its enclosing plates, nearest first,
 * then any plate elsewhere. Two plates may share a loop variable with different
 * ranges (`for (k in 1:K)` and `for (k in 2:K)` in Alligators), so a node's
 * `k` has to be read against the plate it actually sits in.
 */
function rangesFor(
  node: GraphNode,
  nodeMap: Map<string, GraphNode>,
  global: Map<string, { lo: string; hi: string }>,
): Map<string, { lo: string; hi: string }> {
  const ranges = new Map(global);
  const chain: GraphNode[] = [];
  for (
    let p = node.parent ? nodeMap.get(node.parent) : undefined;
    p;
    p = p.parent ? nodeMap.get(p.parent) : undefined
  ) {
    chain.push(p);
  }
  // Outermost first, so the nearest plate's range is the one that survives.
  for (const p of chain.reverse()) {
    const parts = (p.loopRange || "").split(":").map((s) => s.trim());
    if (p.loopVariable && parts.length === 2) {
      ranges.set(p.loopVariable, { lo: parts[0] as string, hi: parts[1] as string });
    }
  }
  return ranges;
}

function indexCoverage(
  index: string,
  ranges: Map<string, { lo: string; hi: string }>,
): IndexCoverage {
  const idx = index.trim();
  if (/^\d+$/.test(idx)) return { kind: "literal", value: Number(idx) };
  const range = ranges.get(idx);
  if (range) return { kind: "range", ...range };
  const slice = idx.match(/^(\S+)\s*:\s*(\S+)$/);
  if (slice) return { kind: "range", lo: slice[1] as string, hi: slice[2] as string };
  return { kind: "unknown" };
}

/**
 * Whether two coverages provably share an element. Anything not provable counts
 * as no overlap, so a symbolic bound never invents a conflict. A range always
 * contains its own lower bound, which is what catches z[1] beside z[i] over 1:N.
 */
function coveragesOverlap(a: IndexCoverage, b: IndexCoverage): boolean {
  if (a.kind === "unknown" || b.kind === "unknown") return false;
  if (a.kind === "literal" && b.kind === "literal") return a.value === b.value;
  if (a.kind === "range" && b.kind === "range") return a.lo === b.lo && a.hi === b.hi;
  const literal = (a.kind === "literal" ? a : b) as { kind: "literal"; value: number };
  const range = (a.kind === "range" ? a : b) as { kind: "range"; lo: string; hi: string };
  if (!/^\d+$/.test(range.lo)) return false;
  const lo = Number(range.lo);
  if (literal.value === lo) return true;
  return /^\d+$/.test(range.hi) && literal.value >= lo && literal.value <= Number(range.hi);
}

/** A node's index expressions, taken from `indices` or from brackets in its name. */
function nodeIndexList(node: GraphNode): string[] {
  const declared = (node.indices ?? "").trim();
  const inName = node.name.match(/\[([^\]]*)\]/);
  const raw = declared !== "" ? declared : (inName?.[1] ?? "");
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "");
}

/**
 * BUGS lets one variable be defined by several statements over disjoint index
 * ranges (the seeded recursions in Ice and Dogs); what it forbids is two
 * statements defining the same array location. Mirrors JuliaBUGS, which tracks
 * assignments per location rather than per name.
 */
function indexOverlapIssues(nodes: GraphNode[], language: ModelLanguage): ValidationIssue[] {
  const ranges = plateRanges(nodes);
  // Two statements on one element conflict only when both define it. A `<-`
  // beside an observed `~` on the same element is the data-transform idiom
  // (Endo fixes Y[i, 1] and Y[i, 2], then Y[i, 1:J] ~ dmulti). In Stan an `=`
  // followed by `~` is a prior on a transformed quantity and two `~` add their
  // densities, so only two assignments can clash there.
  const conflicts = (a: GraphNode, b: GraphNode): boolean => {
    const det = (n: GraphNode) => n.nodeType === "deterministic";
    const obs = (n: GraphNode) => n.nodeType === "observed";
    if ((det(a) && obs(b)) || (obs(a) && det(b))) return false;
    if (language === "stan") return det(a) && det(b);
    return true;
  };
  const assigning = nodes.filter(
    (n) =>
      n.nodeType === "stochastic" || n.nodeType === "observed" || n.nodeType === "deterministic",
  );
  const byName = new Map<string, GraphNode[]>();
  for (const n of assigning) {
    const base = (n.name.split("[")[0] as string).trim();
    byName.set(base, [...(byName.get(base) ?? []), n]);
  }

  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const issues: ValidationIssue[] = [];
  for (const [name, group] of byName) {
    if (group.length < 2) continue;
    const coverage = group.map((n) =>
      nodeIndexList(n).map((idx) => indexCoverage(idx, rangesFor(n, nodeMap, ranges))),
    );
    for (let a = 0; a < group.length; a++) {
      for (let b = a + 1; b < group.length; b++) {
        const ca = coverage[a] as IndexCoverage[];
        const cb = coverage[b] as IndexCoverage[];
        if (ca.length !== cb.length) continue;
        if (!conflicts(group[a] as GraphNode, group[b] as GraphNode)) continue;
        const scalars = ca.length === 0;
        if (scalars || ca.every((cov, i) => coveragesOverlap(cov, cb[i] as IndexCoverage))) {
          issues.push({
            nodeId: (group[b] as GraphNode).id,
            field: "name",
            message: `'${name}' is already defined by another node covering the same indices; BUGS allows several statements per variable only over disjoint ranges.`,
          });
        }
      }
    }
  }
  return issues;
}

/**
 * Validate a DoodleBUGS graph against the model data, returning one issue per
 * problem. Ported from the editor's graph validator: distribution parameter
 * counts (an input counts when it arrives by edge or as a non-node literal),
 * deterministic equations referencing only parents, data, or loop indices,
 * observed nodes backed by data, BUGS variable-name validity, and index-range
 * overlap between nodes that share a name.
 */
export interface ValidateOptions {
  /** Which language's variable-name rules apply. Default BUGS. */
  language?: ModelLanguage;
}

// BUGS names take letters, digits and dots; Stan names take letters, digits and
// underscores, and may not end in a double underscore (reserved).
const NAME_RULES: Record<ModelLanguage, { ok: (name: string) => boolean; label: string }> = {
  bugs: { ok: (n) => /^[a-zA-Z][a-zA-Z0-9.]*$/.test(n), label: "BUGS" },
  stan: { ok: (n) => /^[a-zA-Z][a-zA-Z0-9_]*$/.test(n) && !n.endsWith("__"), label: "Stan" },
};

export function validateGraph(
  elements: GraphElement[],
  data: Record<string, unknown> = {},
  options: ValidateOptions = {},
): ValidationIssue[] {
  const nodes = elements.filter((el): el is GraphNode => el.type === "node");
  const edges = elements.filter((el): el is GraphEdge => el.type === "edge");
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const dataKeys = new Set(Object.keys(data));
  const language = options.language ?? "bugs";
  const nameRule = NAME_RULES[language];
  // Variables some element of which the model assigns.
  const assignedNames = new Set(
    nodes.filter((n) => n.nodeType === "deterministic").map((n) => n.name),
  );

  const issues: ValidationIssue[] = indexOverlapIssues(nodes, language);

  for (const node of nodes) {
    if (node.nodeType === "stochastic" || node.nodeType === "observed") {
      const dist = getDistribution(node.distribution ?? "");
      if (dist) {
        // Each filled param slot is one input. An incoming edge adds an input only
        // when no param expression mentions that parent, since an edge and a
        // reference (including a nested one like mu[z[i]]) are the same dependency.
        const params = paramValues(node);
        const referenced = new Set<string>();
        for (const p of params) {
          for (const ident of p.match(/[A-Za-z_][A-Za-z0-9_.]*/g) ?? []) referenced.add(ident);
        }
        // A parent that only feeds the node's equation (`y <- 1 - Y` before
        // `y ~ dbern(p)`) or a censoring bound is not a distribution input.
        const elsewhere = new Set<string>();
        for (const text of [node.equation, node.censorLower, node.censorUpper]) {
          for (const ident of text?.match(/[A-Za-z_][A-Za-z0-9_.]*/g) ?? []) elsewhere.add(ident);
        }
        const parentNames = new Set<string>();
        for (const e of edges) {
          if (e.target !== node.id) continue;
          const source = nodeMap.get(e.source);
          if (!source || referenced.has(source.name)) continue;
          if (elsewhere.has(source.name)) continue;
          parentNames.add(source.name);
        }
        const provided = params.length + parentNames.size;
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
        // Numeric literals go first, or `1.0E-6` reads as a variable named E; a
        // name followed by `(` is a function call in either language.
        const text = node.equation.replace(/\b\d+(?:\.\d*)?(?:[eE][+-]?\d+)?\b/g, " ");
        const called = new Set(
          [...text.matchAll(/([a-zA-Z_][a-zA-Z0-9_.]*)\s*\(/g)].map((m) => m[1] as string),
        );
        const identifiers = new Set(text.match(/[a-zA-Z_][a-zA-Z0-9_.]*/g) ?? []);
        for (const identifier of identifiers) {
          if (BUGS_FUNCTIONS.has(identifier) || called.has(identifier)) continue;
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

    // An observed node whose value is written by the model, on this node
    // (`y <- 1 - Y` then `y ~ dbern(p)`) or on sibling elements of the same
    // variable (Endo fixes Y[i, 1] and Y[i, 2], then Y[i, 1:J] ~ dmulti), has no
    // data to ask for.
    const fixedByModel = Boolean(node.equation?.trim()) || assignedNames.has(node.name);
    if (node.observed && !fixedByModel && !dataKeys.has(node.name)) {
      issues.push({
        nodeId: node.id,
        field: "name",
        message: `Node is marked as observed, but no data found for '${node.name}'.`,
      });
    }

    // Plates are exempt: their name is only a UI label.
    if (node.nodeType !== "plate") {
      const baseName = (node.name.split("[")[0] as string).trim();
      if (!nameRule.ok(baseName)) {
        issues.push({
          nodeId: node.id,
          field: "name",
          message: `Base name '${baseName}' is not a valid ${nameRule.label} variable name.`,
        });
      }
    }
  }

  return issues;
}
