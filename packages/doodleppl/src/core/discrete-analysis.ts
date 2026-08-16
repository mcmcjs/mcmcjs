// Codegen-time analysis of discrete latent variables for marginalized Stan
// emission. Ports the frontier/separator approach of JuliaBUGS's automatic
// marginalization: classify discrete-finite latents, resolve their support,
// group the factors that read them, and compute a variable-elimination plan
// whose intermediate factor scopes are the minimal discrete frontiers.
import type { GraphEdge, GraphElement, GraphNode } from "./types";

/** Finite support of a discrete latent: values lo .. lo + size - 1 (size may be symbolic). */
export interface SupportInfo {
  /** Stan expression for the number of support values, e.g. "2" or "K". */
  size: string;
  /** First support value: 1 for dcat, 0 for dbern. */
  lo: number;
}

export type LatentTier = "iid-plate" | "scalar-dag" | "unsupported";

export interface DiscreteLatent {
  node: GraphNode;
  tier: LatentTier;
  support: SupportInfo | null;
  /** Why the latent cannot be marginalized (tier "unsupported" only). */
  reason?: string;
}

/** Marginalization plan for one iid discrete latent inside a plate. */
export interface PlatePlan {
  latent: GraphNode;
  plate: GraphNode;
  support: SupportInfo;
  /** Stochastic nodes whose density term joins the per-iteration sum (excluding the latent's own prior). */
  factors: GraphNode[];
  /** Deterministic nodes that must be inlined into factor expressions. */
  inlineDets: GraphNode[];
}

/** One variable-elimination step for the scalar-DAG tier. */
export interface ScalarElimStep {
  latent: GraphNode;
  support: SupportInfo;
  /** Original factors consumed by this step (the latent's own prior is implicit). */
  bucketFactors: GraphNode[];
  /** Latents whose intermediate phi tables are consumed by this step. */
  bucketPhis: GraphNode[];
  /** Remaining discrete scope of the produced phi table (the frontier). */
  scopeAfter: GraphNode[];
}

export interface ScalarDagPlan {
  /** Latents in topological order (the recovery sampling order). */
  latents: GraphNode[];
  /** Elimination steps, reverse topological order. */
  steps: ScalarElimStep[];
  /** Every non-latent stochastic node consumed by some bucket. */
  factors: GraphNode[];
  inlineDets: GraphNode[];
}

export interface DiscreteAnalysis {
  latents: DiscreteLatent[];
  platePlans: PlatePlan[];
  scalarPlan: ScalarDagPlan | null;
  /** Stochastic node ids whose density statement is emitted by a marginalization block. */
  consumedFactorIds: Set<string>;
  /** Deterministic node ids inlined into marginalization blocks (skip their normal emission). */
  inlinedDetIds: Set<string>;
  /** Diagnostics to surface as generated-code comments. */
  issues: string[];
}

/** Discrete distributions with enumerable finite support handled by the marginalizer. */
const MARGINALIZABLE_DISTS = new Set(["dcat", "dbern"]);

/** Frontier configurations above this count get a cost warning in the generated code. */
const FRONTIER_COST_WARN = 10_000;

const IDENT_RE = /(?<![0-9.])([A-Za-z_][A-Za-z0-9_.]*)\s*(\[([^\]]*)\])?/g;

function nodeExprs(node: GraphNode): string[] {
  const vals = [node.equation, node.param1, node.param2, node.param3];
  return vals.filter((v): v is string => v !== undefined && String(v).trim() !== "").map(String);
}

/** Names referenced in a node's params/equation (base names, subscripts stripped). */
function referencedNames(node: GraphNode): Set<string> {
  const names = new Set<string>();
  for (const expr of nodeExprs(node)) {
    IDENT_RE.lastIndex = 0;
    let m: RegExpExecArray | null = IDENT_RE.exec(expr);
    while (m !== null) {
      const after = expr.charAt(m.index + (m[1] as string).length);
      if (after !== "(") names.add(m[1] as string);
      m = IDENT_RE.exec(expr);
    }
  }
  return names;
}

interface Ctx {
  nodes: GraphNode[];
  nodeMap: Map<string, GraphNode>;
  nameToNode: Map<string, GraphNode>;
  /** node id -> parent node ids (edges plus parsed expression references). */
  parents: Map<string, Set<string>>;
}

function buildCtx(elements: GraphElement[]): Ctx {
  const nodes = elements.filter((el): el is GraphNode => el.type === "node");
  const edges = elements.filter((el): el is GraphEdge => el.type === "edge");
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const nameToNode = new Map(nodes.filter((n) => n.nodeType !== "plate").map((n) => [n.name, n]));

  const parents = new Map<string, Set<string>>();
  for (const n of nodes) parents.set(n.id, new Set());
  for (const e of edges) {
    if (nodeMap.has(e.source) && nodeMap.has(e.target)) {
      parents.get(e.target)?.add(e.source);
    }
  }
  for (const n of nodes) {
    if (n.nodeType === "plate") continue;
    for (const name of referencedNames(n)) {
      const ref = nameToNode.get(name);
      if (ref && ref.id !== n.id) parents.get(n.id)?.add(ref.id);
    }
  }
  return { nodes, nodeMap, nameToNode, parents };
}

/** Ids from `targetIds` reachable upward from `node` through deterministic-only chains. */
function discreteScope(node: GraphNode, ctx: Ctx, targetIds: Set<string>): Set<string> {
  const scope = new Set<string>();
  const stack = [...(ctx.parents.get(node.id) ?? [])];
  const seen = new Set<string>();
  while (stack.length > 0) {
    const id = stack.pop() as string;
    if (seen.has(id)) continue;
    seen.add(id);
    const p = ctx.nodeMap.get(id);
    if (!p) continue;
    if (targetIds.has(id)) {
      scope.add(id);
    } else if (p.nodeType === "deterministic") {
      for (const gp of ctx.parents.get(id) ?? []) stack.push(gp);
    }
  }
  return scope;
}

/** Deterministic ancestors of `node` whose own scope touches a discrete latent. */
function detsEnRoute(node: GraphNode, ctx: Ctx, latentIds: Set<string>): GraphNode[] {
  const dets: GraphNode[] = [];
  const stack = [...(ctx.parents.get(node.id) ?? [])];
  const seen = new Set<string>();
  while (stack.length > 0) {
    const id = stack.pop() as string;
    if (seen.has(id)) continue;
    seen.add(id);
    const p = ctx.nodeMap.get(id);
    if (p?.nodeType !== "deterministic") continue;
    if (discreteScope(p, ctx, latentIds).size > 0) {
      dets.push(p);
      for (const gp of ctx.parents.get(id) ?? []) stack.push(gp);
    }
  }
  return dets;
}

function resolveSupport(node: GraphNode, ctx: Ctx): SupportInfo | null {
  if (node.distribution === "dbern") return { size: "2", lo: 0 };
  // dcat: the support size is the length of the probability vector parameter
  const raw = node.param1 ? String(node.param1).trim() : "";
  if (!raw) return null;
  const idxMatch = raw.match(/^([A-Za-z_][A-Za-z0-9_.]*)\s*\[([^\]]*)\]$/);
  if (idxMatch) {
    const subs = (idxMatch[2] as string).split(",").map((s) => s.trim());
    const last = subs[subs.length - 1] ?? "";
    const range = last.match(/^(\S+)\s*:\s*(\S+)$/);
    if (range) {
      const a = range[1] as string;
      const b = range[2] as string;
      if (a === "1") return { size: b, lo: 1 };
      if (/^\d+$/.test(a) && /^\d+$/.test(b)) {
        return { size: String(Number(b) - Number(a) + 1), lo: 1 };
      }
      return { size: `(${b} - ${a} + 1)`, lo: 1 };
    }
    if (last === "" || last === ":") {
      return resolveSupportFromRef(idxMatch[1] as string, ctx);
    }
    return null;
  }
  if (/^[A-Za-z_][A-Za-z0-9_.]*$/.test(raw)) return resolveSupportFromRef(raw, ctx);
  return null;
}

function resolveSupportFromRef(name: string, ctx: Ctx): SupportInfo | null {
  const ref = ctx.nameToNode.get(name);
  if (!ref) return null;
  if (ref.distribution === "ddirich") {
    const p1 = ref.param1 ? String(ref.param1).trim() : "";
    const dim = p1.match(/\[1:(\w+)\]/) || p1.match(/\[(\d+)\]/);
    if (dim) return { size: dim[1] as string, lo: 1 };
  }
  const idx = ref.indices?.trim() ?? "";
  const range = idx.match(/^1\s*:\s*(\S+)$/);
  if (range) return { size: range[1] as string, lo: 1 };
  return null;
}

function plateOf(node: GraphNode, ctx: Ctx): GraphNode | undefined {
  const parent = node.parent ? ctx.nodeMap.get(node.parent) : undefined;
  return parent?.nodeType === "plate" ? parent : undefined;
}

/** Whether any expression of `node` references `name[...loopVar +/- ...]`. */
function hasOffsetRef(node: GraphNode, name: string, loopVar: string): boolean {
  const re = new RegExp(`\\b${name}\\s*\\[[^\\]]*\\b${loopVar}\\s*[+-][^\\]]*\\]`);
  return nodeExprs(node).some((e) => re.test(e));
}

/**
 * Marginalization order over the scalar latents: for each observed node in
 * topological order, place its discrete scope members right before it;
 * remaining latents follow in topological order. Elimination runs in reverse.
 */
function scalarEliminationOrder(
  scalarLatents: GraphNode[],
  ctx: Ctx,
  topoIndex: Map<string, number>,
  scopes: Map<string, Set<string>>,
): GraphNode[] {
  const latentSet = new Set(scalarLatents.map((n) => n.id));
  const placed = new Set<string>();
  const order: GraphNode[] = [];
  const byTopo = (a: string, b: string) => (topoIndex.get(a) ?? 0) - (topoIndex.get(b) ?? 0);
  const observed = ctx.nodes
    .filter((n) => n.nodeType === "observed")
    .sort((a, b) => byTopo(a.id, b.id));
  for (const obs of observed) {
    const scope = [...(scopes.get(obs.id) ?? [])]
      .filter((id) => latentSet.has(id) && !placed.has(id))
      .sort(byTopo);
    for (const id of scope) {
      placed.add(id);
      order.push(ctx.nodeMap.get(id) as GraphNode);
    }
  }
  const remaining = scalarLatents
    .filter((n) => !placed.has(n.id))
    .sort((a, b) => byTopo(a.id, b.id));
  order.push(...remaining);
  return order;
}

/** Analyze discrete latents in a graph and build marginalization plans. */
export function analyzeDiscreteLatents(
  elements: GraphElement[],
  topoOrder: string[],
): DiscreteAnalysis {
  const ctx = buildCtx(elements);
  const topoIndex = new Map(topoOrder.map((id, i) => [id, i]));
  const issues: string[] = [];

  const candidates = ctx.nodes.filter(
    (n) =>
      n.nodeType === "stochastic" &&
      n.distribution !== undefined &&
      MARGINALIZABLE_DISTS.has(n.distribution),
  );
  const candidateIds = new Set(candidates.map((n) => n.id));

  // Discrete-candidate scope of every stochastic/observed node (via deterministic chains).
  const scopes = new Map<string, Set<string>>();
  for (const n of ctx.nodes) {
    if (n.nodeType === "stochastic" || n.nodeType === "observed") {
      scopes.set(n.id, discreteScope(n, ctx, candidateIds));
    }
  }

  const factorsOf = (latentId: string): GraphNode[] =>
    ctx.nodes.filter(
      (n) =>
        n.id !== latentId &&
        (n.nodeType === "stochastic" || n.nodeType === "observed") &&
        (scopes.get(n.id)?.has(latentId) ?? false),
    );

  // First pass: structural tier assignment and support resolution.
  const latents: DiscreteLatent[] = [];
  for (const latent of candidates) {
    const plate = plateOf(latent, ctx);
    if (plate && hasOffsetRef(latent, latent.name, plate.loopVariable || "i")) {
      latents.push({
        node: latent,
        tier: "unsupported",
        support: null,
        reason: `'${latent.name}' depends on itself across plate iterations (chain structure)`,
      });
      continue;
    }
    const support = resolveSupport(latent, ctx);
    if (!support) {
      latents.push({
        node: latent,
        tier: "unsupported",
        support: null,
        reason: `support size of '${latent.name}' could not be resolved from its parameters`,
      });
      continue;
    }
    latents.push({ node: latent, tier: plate ? "iid-plate" : "scalar-dag", support });
  }

  // Second pass: validate structural constraints, demoting until stable so that
  // a demoted latent invalidates any latent sharing a factor with it.
  const byId = new Map(latents.map((l) => [l.node.id, l]));
  const isSupported = (id: string) => (byId.get(id)?.tier ?? "unsupported") !== "unsupported";
  const demote = (entry: DiscreteLatent, reason: string) => {
    entry.tier = "unsupported";
    entry.reason = reason;
  };

  let changed = true;
  while (changed) {
    changed = false;
    for (const entry of latents) {
      if (entry.tier === "unsupported") continue;
      const latent = entry.node;
      const factors = factorsOf(latent.id);
      const fail = validateLatent(entry, factors, ctx, scopes, isSupported, byId);
      if (fail) {
        demote(entry, fail);
        changed = true;
      }
    }
  }

  // Build plans from the surviving latents.
  const consumedFactorIds = new Set<string>();
  const inlinedDetIds = new Set<string>();
  const platePlans: PlatePlan[] = [];
  const scalarLatents: GraphNode[] = [];

  for (const entry of latents) {
    if (entry.tier === "iid-plate") {
      const factors = factorsOf(entry.node.id);
      platePlans.push({
        latent: entry.node,
        plate: plateOf(entry.node, ctx) as GraphNode,
        support: entry.support as SupportInfo,
        factors,
        inlineDets: dedupe(factors.flatMap((f) => detsEnRoute(f, ctx, candidateIds))),
      });
    } else if (entry.tier === "scalar-dag") {
      scalarLatents.push(entry.node);
    }
  }

  for (const plan of platePlans) {
    consumedFactorIds.add(plan.latent.id);
    for (const f of plan.factors) consumedFactorIds.add(f.id);
    for (const d of plan.inlineDets) inlinedDetIds.add(d.id);
  }

  // Scalar tier: bucket variable elimination in reverse marginalization order.
  let scalarPlan: ScalarDagPlan | null = null;
  if (scalarLatents.length > 0) {
    const order = scalarEliminationOrder(scalarLatents, ctx, topoIndex, scopes);
    const scalarIds = new Set(order.map((n) => n.id));
    const supportOf = (id: string) => (byId.get(id) as DiscreteLatent).support as SupportInfo;
    const allFactors = ctx.nodes.filter(
      (n) =>
        (n.nodeType === "stochastic" || n.nodeType === "observed") &&
        !scalarIds.has(n.id) &&
        [...(scopes.get(n.id) ?? [])].some((id) => scalarIds.has(id)),
    );

    type Pending =
      | { kind: "factor"; node: GraphNode; scope: Set<string> }
      | { kind: "phi"; latent: GraphNode; scope: Set<string> };
    const pending: Pending[] = [];
    for (const latent of order) {
      const priorScope = new Set(
        [...(scopes.get(latent.id) ?? [])].filter((id) => scalarIds.has(id)),
      );
      priorScope.add(latent.id);
      pending.push({ kind: "factor", node: latent, scope: priorScope });
    }
    for (const f of allFactors) {
      pending.push({
        kind: "factor",
        node: f,
        scope: new Set([...(scopes.get(f.id) ?? [])].filter((id) => scalarIds.has(id))),
      });
    }

    const steps: ScalarElimStep[] = [];
    for (const latent of [...order].reverse()) {
      const bucket = pending.filter((p) => p.scope.has(latent.id));
      const rest = pending.filter((p) => !p.scope.has(latent.id));
      const scopeAfter = new Set<string>();
      for (const p of bucket) {
        for (const id of p.scope) if (id !== latent.id) scopeAfter.add(id);
      }
      steps.push({
        latent,
        support: supportOf(latent.id),
        bucketFactors: bucket
          .filter((p): p is Extract<Pending, { kind: "factor" }> => p.kind === "factor")
          .map((p) => p.node)
          .filter((n) => n.id !== latent.id),
        bucketPhis: bucket
          .filter((p): p is Extract<Pending, { kind: "phi" }> => p.kind === "phi")
          .map((p) => p.latent),
        scopeAfter: [...scopeAfter].map((id) => ctx.nodeMap.get(id) as GraphNode),
      });
      pending.length = 0;
      pending.push(...rest, { kind: "phi", latent, scope: scopeAfter });
    }

    scalarPlan = {
      latents: order,
      steps,
      factors: allFactors,
      inlineDets: dedupe(allFactors.flatMap((f) => detsEnRoute(f, ctx, candidateIds))),
    };
    for (const latent of order) consumedFactorIds.add(latent.id);
    for (const f of allFactors) consumedFactorIds.add(f.id);
    for (const d of scalarPlan.inlineDets) inlinedDetIds.add(d.id);

    for (const step of steps) {
      const sizes = [step.latent, ...step.scopeAfter].map((n) => Number(supportOf(n.id).size));
      if (sizes.every((s) => Number.isFinite(s))) {
        const cost = sizes.reduce((a, b) => a * b, 1);
        if (cost > FRONTIER_COST_WARN) {
          issues.push(
            `eliminating '${step.latent.name}' enumerates ${cost} configurations; consider restructuring the model`,
          );
        }
      }
    }
  }

  return { latents, platePlans, scalarPlan, consumedFactorIds, inlinedDetIds, issues };
}

/** Returns a demotion reason, or null when the latent's structure is marginalizable. */
function validateLatent(
  entry: DiscreteLatent,
  factors: GraphNode[],
  ctx: Ctx,
  scopes: Map<string, Set<string>>,
  isSupported: (id: string) => boolean,
  byId: Map<string, DiscreteLatent>,
): string | null {
  const latent = entry.node;
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(latent.name)) {
    return `latent name '${latent.name}' is not a plain identifier`;
  }
  if (latent.censorLower || latent.censorUpper || latent.equation?.trim()) {
    return `'${latent.name}' has censoring or a data transform`;
  }
  if (factors.length === 0) {
    return `'${latent.name}' has no factors reading it; marginalizing it would be a no-op`;
  }
  for (const f of factors) {
    if (f.censorLower || f.censorUpper || f.equation?.trim()) {
      return `factor '${f.name}' of '${latent.name}' has censoring or a data transform`;
    }
    const dist = f.distribution ?? "";
    if (dist === "" || dist === "dflat") {
      return `factor '${f.name}' of '${latent.name}' has no translatable distribution`;
    }
  }
  // Every deterministic node carrying this latent must be inlinable into some factor;
  // a deterministic reader that reaches no factor (e.g. one feeding only generated
  // quantities) would reference a variable that no longer exists.
  const latentOnly = new Set([latent.id]);
  const enRoute = new Set(factors.flatMap((f) => detsEnRoute(f, ctx, latentOnly)).map((d) => d.id));
  for (const det of ctx.nodes) {
    if (det.nodeType !== "deterministic") continue;
    if (discreteScope(det, ctx, latentOnly).size > 0 && !enRoute.has(det.id)) {
      return `deterministic node '${det.name}' reads '${latent.name}' but feeds no factor`;
    }
  }

  if (entry.tier === "iid-plate") {
    const plate = plateOf(latent, ctx) as GraphNode;
    const loopVar = plate.loopVariable || "i";
    const range = (plate.loopRange || "1:N").trim();
    if (!range.startsWith("1:") || (latent.indices || "").trim() !== loopVar) {
      return `'${latent.name}' is in a plate structure the marginalizer does not handle`;
    }
    if (plateOf(plate, ctx) !== undefined) {
      return `'${latent.name}' is inside nested plates, which the marginalizer does not handle`;
    }
    for (const f of factors) {
      if (plateOf(f, ctx)?.id !== plate.id) {
        return `factor '${f.name}' reads '${latent.name}' from outside its plate`;
      }
      if (hasOffsetRef(f, latent.name, loopVar)) {
        return `factor '${f.name}' reads '${latent.name}' across plate iterations`;
      }
      const others = [...(scopes.get(f.id) ?? [])].filter((id) => id !== latent.id);
      if (others.length > 0) {
        return `factor '${f.name}' reads '${latent.name}' and another discrete latent`;
      }
    }
    const priorScope = scopes.get(latent.id) ?? new Set();
    if (priorScope.size > 0) {
      return `the prior of '${latent.name}' depends on another discrete latent`;
    }
    return null;
  }

  // scalar-dag: the latent, its factors, and every co-read latent must be scalar and supported
  for (const f of factors) {
    if (plateOf(f, ctx) !== undefined) {
      return `factor '${f.name}' of scalar latent '${latent.name}' is inside a plate`;
    }
    for (const id of scopes.get(f.id) ?? []) {
      if (!isSupported(id) || byId.get(id)?.tier !== "scalar-dag") {
        return `factor '${f.name}' also reads a discrete latent the marginalizer cannot handle`;
      }
    }
  }
  for (const id of scopes.get(latent.id) ?? []) {
    if (!isSupported(id) || byId.get(id)?.tier !== "scalar-dag") {
      return `the prior of '${latent.name}' reads a discrete latent the marginalizer cannot handle`;
    }
  }
  return null;
}

function dedupe(nodes: GraphNode[]): GraphNode[] {
  const seen = new Set<string>();
  return nodes.filter((n) => {
    if (seen.has(n.id)) return false;
    seen.add(n.id);
    return true;
  });
}

/** Base names of latents that the marginalized Stan program no longer declares as parameters. */
export function marginalizedLatentNames(elements: GraphElement[], topoOrder: string[]): string[] {
  const analysis = analyzeDiscreteLatents(elements, topoOrder);
  return analysis.latents.filter((l) => l.tier !== "unsupported").map((l) => l.node.name);
}
