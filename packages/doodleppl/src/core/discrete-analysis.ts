// Codegen-time analysis of discrete latent variables for marginalized Stan
// emission. Ports the frontier/separator approach of JuliaBUGS's automatic
// marginalization: classify discrete-finite latents, resolve their support,
// group the factors that read them, and compute a variable-elimination plan
// whose intermediate factor scopes are the minimal discrete frontiers.
// Any structure the analysis cannot prove safe demotes the latent, so the
// generator falls back to its warning comments instead of emitting wrong code.
import type { GraphEdge, GraphElement, GraphNode } from "./types";

/** Discrete distributions Stan cannot sample as latent parameters. */
export const DISCRETE_DISTRIBUTIONS = new Set([
  "dbern",
  "dbin",
  "dpois",
  "dcat",
  "dnegbin",
  "dgeom",
  "dhyper",
  "dbetabin",
]);

/** Finite support of a discrete latent: values lo .. lo + size - 1 (size may be symbolic). */
export interface SupportInfo {
  /** Stan expression for the number of support values, e.g. "2" or "K". */
  size: string;
  /** First support value: 1 for dcat, 0 for dbern. */
  lo: number;
}

export type LatentTier = "iid-plate" | "scalar-dag" | "chain" | "unsupported";

export interface DiscreteLatent {
  node: GraphNode;
  tier: LatentTier;
  support: SupportInfo | null;
  /** True for an observed node with missing entries: only those entries are marginalized. */
  partial: boolean;
  /** Why the latent cannot be marginalized (tier "unsupported" only). */
  reason?: string;
}

/** Marginalization plan for one iid discrete latent inside one or more plates. */
export interface PlatePlan {
  latent: GraphNode;
  /** Enclosing plates, outermost first; the latent's indices are their loop variables. */
  plates: GraphNode[];
  support: SupportInfo;
  /** Partially observed: iterations with data score pointwise, the rest marginalize. */
  partial: boolean;
  /** Stochastic nodes whose density term joins the per-iteration sum (excluding the latent's own prior). */
  factors: GraphNode[];
  /** Deterministic nodes that must be inlined into factor expressions. */
  inlineDets: GraphNode[];
}

/** One variable-elimination step for the scalar-DAG tier. */
export interface ScalarElimStep {
  latent: GraphNode;
  support: SupportInfo;
  /** Factors consumed by this step; a latent node here stands for its own prior term. */
  bucketFactors: GraphNode[];
  /** Latents whose intermediate phi tables are consumed by this step. */
  bucketPhis: GraphNode[];
  /** Remaining discrete scope of the produced phi table (the frontier). */
  scopeAfter: GraphNode[];
}

/** How an emission factor is indexed in time, so it can be rendered at a given step. */
export interface ChainEmission {
  node: GraphNode;
  /** Loop variable to replace with the current time, when the factor sits in a plate. */
  loopVar: string | null;
  /** Fixed time this factor covers, when it is indexed by a literal. */
  literalTime: number | null;
  /** First time step this factor covers. */
  from: number;
}

/**
 * Marginalization plan for a chain: one variable seeded at `first` and defined
 * recursively over a plate, whose frontier is the single previous state, so the
 * enumeration collapses to a forward recursion over a table of `support` entries.
 */
export interface ChainPlan {
  name: string;
  /** The seeding node, e.g. z[1]. */
  init: GraphNode;
  /** The recursive node, e.g. z[t] over 2:T, referencing z[t - 1]. */
  transition: GraphNode;
  plate: GraphNode;
  loopVar: string;
  /** Upper bound of the chain, e.g. "T". */
  upper: string;
  /** Index the chain starts at. */
  first: number;
  support: SupportInfo;
  emissions: ChainEmission[];
  inlineDets: GraphNode[];
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
  chainPlans: ChainPlan[];
  scalarPlan: ScalarDagPlan | null;
  /** Stochastic node ids whose density statement is emitted by a marginalization block. */
  consumedFactorIds: Set<string>;
  /** Deterministic node ids inlined into marginalization blocks (skip their normal emission). */
  inlinedDetIds: Set<string>;
  /** Diagnostics to surface as generated-code comments. */
  issues: string[];
}

export interface AnalyzeOptions {
  /** Whether the target-language generator can translate a distribution's density. */
  canTranslate?: (dist: string) => boolean;
  /** Ids of observed discrete nodes whose data has missing entries. */
  partialIds?: Set<string>;
}

/** Discrete distributions with enumerable finite support handled by the marginalizer. */
const MARGINALIZABLE_DISTS = new Set(["dcat", "dbern", "dbin"]);

/** Frontier configurations above this count get a cost warning in the generated code. */
export const FRONTIER_COST_WARN = 10_000;

const IDENT_RE = /(?<![0-9.])([A-Za-z_][A-Za-z0-9_.]*)\s*(\[([^\]]*)\])?/g;

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

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
  nodeNames: Set<string>;
  /** node id -> parent node ids (edges plus parsed expression references). */
  parents: Map<string, Set<string>>;
}

function buildCtx(elements: GraphElement[]): Ctx {
  const nodes = elements.filter((el): el is GraphNode => el.type === "node");
  const edges = elements.filter((el): el is GraphEdge => el.type === "edge");
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const nonPlate = nodes.filter((n) => n.nodeType !== "plate");
  const nameToNode = new Map(nonPlate.map((n) => [n.name, n]));

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
  return { nodes, nodeMap, nameToNode, nodeNames: new Set(nonPlate.map((n) => n.name)), parents };
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

/** Split on commas outside brackets, so `z[t - 1], 1:K` yields two parts. */
function splitTopLevelCommas(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of text) {
    if (ch === "[") depth++;
    if (ch === "]") depth--;
    if (ch === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  parts.push(current.trim());
  return parts;
}

/** Parse `name[subscripts]`, tolerating nested brackets inside the subscripts. */
function parseIndexedRef(text: string): { base: string; subs: string[] } | null {
  const m = text.match(/^([A-Za-z_][A-Za-z0-9_.]*)\s*\[(.*)\]$/s);
  if (!m) return null;
  let depth = 0;
  for (const ch of m[2] as string) {
    if (ch === "[") depth++;
    else if (ch === "]") depth--;
    if (depth < 0) return null;
  }
  return depth === 0 ? { base: m[1] as string, subs: splitTopLevelCommas(m[2] as string) } : null;
}

function resolveSupport(node: GraphNode, ctx: Ctx): SupportInfo | null {
  if (node.distribution === "dbern") return { size: "2", lo: 0 };
  if (node.distribution === "dbin") {
    // dbin(p, n): support 0 .. n, so n must be a literal or a data scalar.
    const n = node.param2 ? String(node.param2).trim() : "";
    if (/^\d+$/.test(n)) return { size: String(Number(n) + 1), lo: 0 };
    if (/^[A-Za-z_][A-Za-z0-9_.]*$/.test(n)) {
      const ref = ctx.nameToNode.get(n);
      if (ref && ref.nodeType !== "constant") return null;
      return { size: `(${n} + 1)`, lo: 0 };
    }
    return null;
  }
  // dcat: the support size is the length of the probability vector parameter
  const raw = node.param1 ? String(node.param1).trim() : "";
  if (!raw) return null;
  const idxMatch = parseIndexedRef(raw);
  if (idxMatch) {
    const subs = idxMatch.subs;
    const last = subs[subs.length - 1] ?? "";
    const range = last.match(/^(\S+)\s*:\s*(\S+)$/);
    if (range) {
      const a = range[1] as string;
      const b = range[2] as string;
      // dcat values are positions within the slice, so any slice keeps lo = 1;
      // a non-1 lower bound needs numeric endpoints for a definite size.
      if (a === "1") return { size: b, lo: 1 };
      if (/^\d+$/.test(a) && /^\d+$/.test(b) && Number(a) <= Number(b)) {
        return { size: String(Number(b) - Number(a) + 1), lo: 1 };
      }
      return null;
    }
    if (last === "" || last === ":") {
      return resolveSupportFromRef(idxMatch.base, ctx);
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

/** Enclosing plates of a node, outermost first. */
function platesOf(node: GraphNode, ctx: Ctx): GraphNode[] {
  const plates: GraphNode[] = [];
  const seen = new Set<string>([node.id]);
  let current: GraphNode | undefined = node;
  while (current) {
    const plate = plateOf(current, ctx);
    if (!plate || seen.has(plate.id)) break;
    seen.add(plate.id);
    plates.unshift(plate);
    current = plate;
  }
  return plates;
}

const loopVarOf = (plate: GraphNode): string => plate.loopVariable || "i";

/** The index list a latent inside `plates` must carry, e.g. "i,j". */
const plateIndexList = (plates: GraphNode[]): string => plates.map(loopVarOf).join(",");

const normalizeIndices = (indices: string | undefined): string =>
  (indices ?? "")
    .split(",")
    .map((s) => s.trim())
    .join(",");

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

/** Whether any expression of `node` references `name[...loopVar +/- ...]`. */
function hasOffsetRef(node: GraphNode, name: string, loopVar: string): boolean {
  const re = new RegExp(
    `(?<![A-Za-z0-9_])${escapeRe(name)}\\s*\\[[^\\]]*\\b${escapeRe(loopVar)}\\s*[+-][^\\]]*\\]`,
  );
  return nodeExprs(node).some((e) => re.test(e));
}

/**
 * Every reference to the latent in `exprs` must be substitutable: exactly
 * `name[indices]` in the plate tier, exactly bare `name` in the scalar tier.
 */
function referencesAreSubstitutable(
  exprs: string[],
  latentName: string,
  indexList: string | null,
): boolean {
  const re = new RegExp(
    `(?<![A-Za-z0-9_.])${escapeRe(latentName)}(?![A-Za-z0-9_])(\\s*\\[([^\\]]*)\\])?`,
    "g",
  );
  for (const expr of exprs) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null = re.exec(expr);
    while (m !== null) {
      const sub = m[2];
      if (indexList === null) {
        if (sub !== undefined) return false;
      } else if (sub === undefined || normalizeIndices(sub) !== indexList) {
        return false;
      }
      m = re.exec(expr);
    }
  }
  return true;
}

/** Local names the emitters generate for a latent; a user variable with such a name wins. */
function helperNameCollision(name: string, ctx: Ctx): string | null {
  const helpers = [
    `${name}_lp`,
    `${name}_val`,
    `${name}_idx`,
    `${name}_obs`,
    `${name}_is_obs`,
    `phi_${name}`,
    `marg_conf_${name}`,
  ];
  for (const h of helpers) {
    if (ctx.nodeNames.has(h)) return h;
  }
  for (const global of ["marg_joint_lp", "marg_c", "marg_pick"]) {
    if (ctx.nodeNames.has(global)) return global;
  }
  return null;
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

/** The offset in a self-reference like `z[t - 1]`, or null when there is none. */
function selfRefOffset(node: GraphNode, name: string, loopVar: string): number | null {
  const re = new RegExp(
    `(?<![A-Za-z0-9_])${escapeRe(name)}\\s*\\[\\s*${escapeRe(loopVar)}\\s*-\\s*(\\d+)\\s*\\]`,
  );
  for (const expr of nodeExprs(node)) {
    const m = expr.match(re);
    if (m) return Number(m[1]);
  }
  return null;
}

function plateBounds(plate: GraphNode): { lo: string; hi: string } | null {
  const parts = (plate.loopRange || "1:N").split(":").map((s) => s.trim());
  return parts.length === 2 ? { lo: parts[0] as string, hi: parts[1] as string } : null;
}

/**
 * Detect a chain: one variable seeded at a literal index and defined recursively
 * one step back over a plate starting at the next index. Returns the plan, or a
 * reason the pair looks like a chain but cannot be handled.
 */
function detectChain(
  group: DiscreteLatent[],
  ctx: Ctx,
  candidateIds: Set<string>,
  canTranslate: (dist: string) => boolean,
): { plan: ChainPlan } | { reason: string } | null {
  if (group.length !== 2) return null;
  const inPlate = group.filter((l) => plateOf(l.node, ctx) !== undefined);
  const seeds = group.filter((l) => plateOf(l.node, ctx) === undefined);
  if (inPlate.length !== 1 || seeds.length !== 1) return null;

  const transition = inPlate[0] as DiscreteLatent;
  const init = seeds[0] as DiscreteLatent;
  const plate = plateOf(transition.node, ctx) as GraphNode;
  const loopVar = loopVarOf(plate);
  const offset = selfRefOffset(transition.node, transition.node.name, loopVar);
  if (offset === null) return null;

  const name = transition.node.name;
  const bounds = plateBounds(plate);
  const firstIndex = nodeIndexList(init.node);
  const first = Number(firstIndex[0]);
  if (
    !bounds ||
    firstIndex.length !== 1 ||
    !Number.isInteger(first) ||
    normalizeIndices(transition.node.indices) !== loopVar
  ) {
    return { reason: `'${name}' is a chain in a shape the marginalizer does not handle` };
  }
  if (offset !== 1) {
    return { reason: `'${name}' looks back ${offset} steps; only one step is handled` };
  }
  if (Number(bounds.lo) !== first + 1) {
    return {
      reason: `'${name}' is seeded at ${first} but its plate starts at ${bounds.lo}`,
    };
  }
  if (!init.support || !transition.support) {
    return { reason: `support size of '${name}' could not be resolved from its parameters` };
  }
  if (init.support.size !== transition.support.size || init.support.lo !== transition.support.lo) {
    return { reason: `'${name}' has different support in its seed and its recursion` };
  }
  for (const l of group) {
    const n = l.node;
    if (n.censorLower || n.censorUpper || n.equation?.trim()) {
      return { reason: `'${name}' has censoring or a data transform` };
    }
    if (!canTranslate(n.distribution ?? "")) {
      return { reason: `the prior of '${name}' has no translatable distribution` };
    }
  }
  const collision = helperNameCollision(name, ctx);
  if (collision) {
    return { reason: `marginalizing '${name}' would collide with the variable '${collision}'` };
  }

  // Factors reading either chain node become emissions, each renderable at one time step.
  const chainIds = new Set(group.map((l) => l.node.id));
  const emissions: ChainEmission[] = [];
  for (const node of ctx.nodes) {
    if (chainIds.has(node.id)) continue;
    if (node.nodeType !== "stochastic" && node.nodeType !== "observed") continue;
    const readsChain = [...(discreteScope(node, ctx, chainIds) ?? [])].length > 0;
    if (!readsChain) continue;
    if (node.censorLower || node.censorUpper || node.equation?.trim()) {
      return { reason: `factor '${node.name}' of '${name}' has censoring or a data transform` };
    }
    const dist = node.distribution ?? "";
    if (dist === "" || dist === "dflat" || !canTranslate(dist) || dist === "dmulti") {
      return { reason: `factor '${node.name}' of '${name}' has no translatable distribution` };
    }
    if (candidateIds.has(node.id)) {
      return { reason: `factor '${node.name}' of '${name}' is itself a discrete latent` };
    }
    const others = [...discreteScope(node, ctx, candidateIds)].filter((id) => !chainIds.has(id));
    if (others.length > 0) {
      return { reason: `factor '${node.name}' reads '${name}' and another discrete latent` };
    }

    const factorPlate = plateOf(node, ctx);
    const indices = nodeIndexList(node);
    if (factorPlate === undefined && indices.length === 1 && /^\d+$/.test(indices[0] as string)) {
      const time = Number(indices[0]);
      if (time !== first) {
        return { reason: `factor '${node.name}' reads '${name}' at index ${time}, not the seed` };
      }
      if (!referencesAreSubstitutable(nodeExprs(node), name, String(time))) {
        return { reason: `factor '${node.name}' reads '${name}' at another index` };
      }
      emissions.push({ node, loopVar: null, literalTime: time, from: time });
      continue;
    }
    if (factorPlate === undefined || plateOf(factorPlate, ctx) !== undefined) {
      return { reason: `factor '${node.name}' of '${name}' is not indexed by the chain` };
    }
    const fb = plateBounds(factorPlate);
    const fLoop = loopVarOf(factorPlate);
    if (!fb || fb.hi !== bounds.hi || indices.length !== 1 || indices[0] !== fLoop) {
      return { reason: `factor '${node.name}' is not indexed over the same range as '${name}'` };
    }
    if (!referencesAreSubstitutable(nodeExprs(node), name, fLoop)) {
      return { reason: `factor '${node.name}' reads '${name}' at a shifted index` };
    }
    emissions.push({ node, loopVar: fLoop, literalTime: null, from: Number(fb.lo) });
  }

  if (emissions.length === 0) {
    return { reason: `'${name}' has no factors reading it; marginalizing it would be a no-op` };
  }
  // Deterministic carriers are not substituted inside the recursion yet.
  const dets = dedupe(
    [...emissions.map((em) => em.node), ...group.map((l) => l.node)].flatMap((n) =>
      detsEnRoute(n, ctx, chainIds),
    ),
  );
  if (dets.length > 0) {
    return {
      reason: `'${name}' reaches a factor through the deterministic node '${(dets[0] as GraphNode).name}'`,
    };
  }

  return {
    plan: {
      name,
      init: init.node,
      transition: transition.node,
      plate,
      loopVar,
      upper: bounds.hi,
      first,
      support: transition.support,
      emissions,
      inlineDets: [],
    },
  };
}

/** Analyze discrete latents in a graph and build marginalization plans. */
export function analyzeDiscreteLatents(
  elements: GraphElement[],
  topoOrder: string[],
  options: AnalyzeOptions = {},
): DiscreteAnalysis {
  const ctx = buildCtx(elements);
  const topoIndex = new Map(topoOrder.map((id, i) => [id, i]));
  const canTranslate = options.canTranslate ?? (() => true);
  const partialIds = options.partialIds ?? new Set<string>();
  const issues: string[] = [];

  const candidates = ctx.nodes.filter(
    (n) =>
      (n.nodeType === "stochastic" || (n.nodeType === "observed" && partialIds.has(n.id))) &&
      n.distribution !== undefined &&
      MARGINALIZABLE_DISTS.has(n.distribution) &&
      /^[A-Za-z_][A-Za-z0-9_]*$/.test(n.name),
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
    const partial = partialIds.has(latent.id);
    const plate = plateOf(latent, ctx);
    if (partial && !plate) {
      latents.push({
        node: latent,
        tier: "unsupported",
        support: null,
        partial,
        reason: `partially observed '${latent.name}' is only supported inside a plate`,
      });
      continue;
    }
    const support = resolveSupport(latent, ctx);
    const enclosing = platesOf(latent, ctx);
    // Keep the support: the chain pass needs it to upgrade this node.
    if (enclosing.some((p) => hasOffsetRef(latent, latent.name, loopVarOf(p)))) {
      latents.push({
        node: latent,
        tier: "unsupported",
        support,
        partial,
        reason: `'${latent.name}' depends on itself across plate iterations (chain structure)`,
      });
      continue;
    }
    if (!support) {
      latents.push({
        node: latent,
        tier: "unsupported",
        support: null,
        partial,
        reason: `support size of '${latent.name}' could not be resolved from its parameters`,
      });
      continue;
    }
    latents.push({ node: latent, tier: plate ? "iid-plate" : "scalar-dag", support, partial });
  }

  // Chain pass: a variable seeded at one index and recursive over a plate is a
  // chain, so upgrade both nodes ahead of the per-latent structural checks.
  const chainPlans: ChainPlan[] = [];
  const byName = new Map<string, DiscreteLatent[]>();
  for (const entry of latents) {
    byName.set(entry.node.name, [...(byName.get(entry.node.name) ?? []), entry]);
  }
  for (const group of byName.values()) {
    const outcome = detectChain(group, ctx, candidateIds, canTranslate);
    if (outcome === null) continue;
    for (const entry of group) {
      if ("plan" in outcome) {
        entry.tier = "chain";
        entry.reason = undefined;
      } else {
        entry.tier = "unsupported";
        entry.reason = outcome.reason;
      }
    }
    if ("plan" in outcome) chainPlans.push(outcome.plan);
  }

  // Second pass: validate structural constraints, demoting until stable so that
  // a demoted latent invalidates any latent sharing structure with it.
  const byId = new Map(latents.map((l) => [l.node.id, l]));
  const isSupported = (id: string) => (byId.get(id)?.tier ?? "unsupported") !== "unsupported";

  let changed = true;
  while (changed) {
    changed = false;
    for (const entry of latents) {
      if (entry.tier === "unsupported" || entry.tier === "chain") continue;
      const fail = validateLatent(
        entry,
        factorsOf(entry.node.id),
        ctx,
        scopes,
        isSupported,
        byId,
        candidateIds,
        canTranslate,
      );
      if (fail) {
        entry.tier = "unsupported";
        entry.reason = fail;
        changed = true;
      }
    }
  }

  // A chain demoted after detection (its group failed elsewhere) drops its plan.
  const survivingChains = chainPlans.filter(
    (plan) => byId.get(plan.transition.id)?.tier === "chain",
  );

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
        plates: platesOf(entry.node, ctx),
        support: entry.support as SupportInfo,
        partial: entry.partial,
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

  for (const plan of survivingChains) {
    consumedFactorIds.add(plan.init.id);
    consumedFactorIds.add(plan.transition.id);
    for (const em of plan.emissions) consumedFactorIds.add(em.node.id);
  }

  // Scalar tier: bucket variable elimination in reverse marginalization order.
  // Each latent's own prior enters the pending pool as an ordinary factor and is
  // consumed by exactly one bucket (dependent priors land in the parent's bucket).
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
          .map((p) => p.node),
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
      inlineDets: dedupe(
        [...allFactors, ...order].flatMap((f) => detsEnRoute(f, ctx, candidateIds)),
      ),
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

  return {
    latents,
    platePlans,
    chainPlans: survivingChains,
    scalarPlan,
    consumedFactorIds,
    inlinedDetIds,
    issues,
  };
}

/** Returns a demotion reason, or null when the latent's structure is marginalizable. */
function validateLatent(
  entry: DiscreteLatent,
  factors: GraphNode[],
  ctx: Ctx,
  scopes: Map<string, Set<string>>,
  isSupported: (id: string) => boolean,
  byId: Map<string, DiscreteLatent>,
  candidateIds: Set<string>,
  canTranslate: (dist: string) => boolean,
): string | null {
  const latent = entry.node;
  if (latent.censorLower || latent.censorUpper || latent.equation?.trim()) {
    return `'${latent.name}' has censoring or a data transform`;
  }
  if (!canTranslate(latent.distribution ?? "")) {
    return `the prior of '${latent.name}' has no translatable distribution`;
  }
  const collision = helperNameCollision(latent.name, ctx);
  if (collision) {
    return `marginalizing '${latent.name}' would collide with the variable '${collision}'`;
  }
  // A partial latent's observed entries contribute their density even with no readers.
  if (factors.length === 0 && !entry.partial) {
    return `'${latent.name}' has no factors reading it; marginalizing it would be a no-op`;
  }

  const isScalarSupported = (id: string) => isSupported(id) && byId.get(id)?.tier === "scalar-dag";

  for (const f of factors) {
    if (f.censorLower || f.censorUpper || f.equation?.trim()) {
      return `factor '${f.name}' of '${latent.name}' has censoring or a data transform`;
    }
    const dist = f.distribution ?? "";
    if (dist === "" || dist === "dflat" || !canTranslate(dist)) {
      return `factor '${f.name}' of '${latent.name}' has no translatable distribution`;
    }
    if (dist === "dmulti") {
      return `factor '${f.name}' of '${latent.name}' is multinomial, which the marginalizer does not handle`;
    }
    // An unobserved discrete factor is itself an unsampleable latent; only a
    // co-marginalized scalar latent (a dependent prior) is acceptable.
    if (f.nodeType === "stochastic" && DISCRETE_DISTRIBUTIONS.has(dist)) {
      const ok = entry.tier === "scalar-dag" && isScalarSupported(f.id);
      if (!ok) {
        return `factor '${f.name}' of '${latent.name}' is itself a discrete latent Stan cannot sample`;
      }
    }
  }

  // Every deterministic node carrying this latent must be inlinable into some
  // factor or a co-marginalized prior; a reader that reaches neither would
  // reference a variable that no longer exists.
  const latentOnly = new Set([latent.id]);
  const enRoute = new Set(
    [...factors, latent].flatMap((f) => detsEnRoute(f, ctx, latentOnly)).map((d) => d.id),
  );
  for (const det of ctx.nodes) {
    if (det.nodeType !== "deterministic") continue;
    if (discreteScope(det, ctx, latentOnly).size > 0 && !enRoute.has(det.id)) {
      return `deterministic node '${det.name}' reads '${latent.name}' but feeds no factor`;
    }
  }

  // All textual references in factors and inlined deterministic nodes must be
  // the exact substitutable form; anything else would survive substitution.
  const inlineDets = dedupe([...factors, latent].flatMap((f) => detsEnRoute(f, ctx, candidateIds)));
  const scannedExprs = [...factors, ...inlineDets].flatMap(nodeExprs);

  if (entry.tier === "iid-plate") {
    const plates = platesOf(latent, ctx);
    const innermost = plates[plates.length - 1] as GraphNode;
    const indexList = plateIndexList(plates);
    const ranges = plates.map((p) => (p.loopRange || "1:N").trim());
    if (ranges.some((r) => !r.startsWith("1:")) || normalizeIndices(latent.indices) !== indexList) {
      return `'${latent.name}' is in a plate structure the marginalizer does not handle`;
    }
    for (const f of factors) {
      if (plateOf(f, ctx)?.id !== innermost.id) {
        return `factor '${f.name}' reads '${latent.name}' from outside its plate`;
      }
      if (candidateIds.has(f.id)) {
        return `factor '${f.name}' of '${latent.name}' is itself a marginalization candidate`;
      }
      const others = [...(scopes.get(f.id) ?? [])].filter((id) => id !== latent.id);
      if (others.length > 0) {
        return `factor '${f.name}' reads '${latent.name}' and another discrete latent`;
      }
    }
    if (!referencesAreSubstitutable(scannedExprs, latent.name, indexList)) {
      return `'${latent.name}' is referenced in a form other than ${latent.name}[${indexList}]`;
    }
    const priorScope = scopes.get(latent.id) ?? new Set();
    if (priorScope.size > 0) {
      return `the prior of '${latent.name}' depends on another discrete latent`;
    }
    return null;
  }

  // scalar-dag: the latent, its factors, and every co-read latent must be scalar and supported
  if ((latent.indices || "").trim() !== "") {
    return `scalar latent '${latent.name}' has array indices`;
  }
  for (const f of factors) {
    if (plateOf(f, ctx) !== undefined) {
      return `factor '${f.name}' of scalar latent '${latent.name}' is inside a plate`;
    }
    for (const id of scopes.get(f.id) ?? []) {
      if (!isScalarSupported(id)) {
        return `factor '${f.name}' also reads a discrete latent the marginalizer cannot handle`;
      }
    }
  }
  for (const id of scopes.get(latent.id) ?? []) {
    if (!isScalarSupported(id)) {
      return `the prior of '${latent.name}' reads a discrete latent the marginalizer cannot handle`;
    }
  }
  if (!referencesAreSubstitutable(scannedExprs, latent.name, null)) {
    return `'${latent.name}' is referenced with a subscript, which a scalar latent cannot have`;
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
export function marginalizedLatentNames(
  elements: GraphElement[],
  topoOrder: string[],
  options: AnalyzeOptions = {},
): string[] {
  const analysis = analyzeDiscreteLatents(elements, topoOrder, options);
  return analysis.latents.filter((l) => l.tier !== "unsupported").map((l) => l.node.name);
}
