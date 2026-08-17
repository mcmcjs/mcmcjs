// Stan code generation from a DoodleBUGS graph, ported from the editor's
// useStanCodeGenerator. The mapping is best-effort: BUGS distributions are
// rewritten to Stan equivalents (precision to scale, parameter order), plates
// become loops or vectorized statements, deterministic nodes are classified
// into transformed data / transformed parameters / generated quantities, and
// constructs Stan cannot express (discrete latents, unmapped distributions)
// are emitted as explanatory comments.
import {
  analyzeDiscreteLatents,
  DISCRETE_DISTRIBUTIONS,
  type DiscreteAnalysis,
  FRONTIER_COST_WARN,
  marginalizedLatentNames,
  type PlatePlan,
  type ScalarDagPlan,
  type SupportInfo,
} from "../core/discrete-analysis";
import { buildTopologicalOrder } from "../core/topo-sort";
import type { GraphEdge, GraphElement, GraphNode } from "../core/types";
import { renderTemplate } from "../templates/render";
import stanRunTemplate from "../templates/stan-run.py.tpl";

interface DistributionMapping {
  stanName: string;
  transformParams: (params: string[], node: GraphNode) => string[];
  stanParamNames: string[];
}

const DISTRIBUTION_MAP: Record<string, DistributionMapping> = {
  dnorm: {
    stanName: "normal",
    stanParamNames: ["mu", "sigma"],
    transformParams: (params) => {
      const [mu, tau] = params;
      return [mu || "0", tau ? `1.0 / sqrt(${tau})` : "1"];
    },
  },
  dgamma: {
    stanName: "gamma",
    stanParamNames: ["alpha", "beta"],
    transformParams: (params) => [params[0] || "0.001", params[1] || "0.001"],
  },
  dbeta: {
    stanName: "beta",
    stanParamNames: ["alpha", "beta"],
    transformParams: (params) => [params[0] || "1", params[1] || "1"],
  },
  dbern: {
    stanName: "bernoulli",
    stanParamNames: ["theta"],
    transformParams: (params) => [params[0] || "0.5"],
  },
  dbin: {
    stanName: "binomial",
    stanParamNames: ["N", "theta"],
    transformParams: (params) => {
      const [prob, size] = params;
      return [size || "1", prob || "0.5"];
    },
  },
  dpois: {
    stanName: "poisson",
    stanParamNames: ["lambda"],
    transformParams: (params) => [params[0] || "1"],
  },
  dexp: {
    stanName: "exponential",
    stanParamNames: ["lambda"],
    transformParams: (params) => [params[0] || "1"],
  },
  dt: {
    stanName: "student_t",
    stanParamNames: ["nu", "mu", "sigma"],
    transformParams: (params) => {
      const [mu, tau, k] = params;
      return [k || "1", mu || "0", tau ? `1.0 / sqrt(${tau})` : "1"];
    },
  },
  dunif: {
    stanName: "uniform",
    stanParamNames: ["alpha", "beta"],
    transformParams: (params) => [params[0] || "0", params[1] || "1"],
  },
  dcat: {
    stanName: "categorical",
    stanParamNames: ["theta"],
    transformParams: (params) => [params[0] || ""],
  },
  dmnorm: {
    stanName: "multi_normal_prec",
    stanParamNames: ["mu", "Omega"],
    transformParams: (params) => [params[0] || "mu", params[1] || "Omega"],
  },
  // BUGS dmt(mu, Omega, k): Omega is precision matrix, k is degrees of freedom.
  // Stan multi_student_t(nu, mu, Sigma): Sigma is scale/covariance matrix = inverse(Omega).
  dmt: {
    stanName: "multi_student_t",
    stanParamNames: ["nu", "mu", "Sigma"],
    transformParams: (params) => {
      const [mu, Omega, k] = params;
      return [k || "1", mu || "mu", Omega ? `inverse(${Omega})` : "Sigma"];
    },
  },
  dwish: {
    stanName: "wishart",
    stanParamNames: ["nu", "S"],
    transformParams: (params) => {
      const [R, k] = params;
      return [k || "1", R ? `inverse(${R})` : "S"];
    },
  },
  ddirich: {
    stanName: "dirichlet",
    stanParamNames: ["alpha"],
    transformParams: (params) => [params[0] || "alpha"],
  },
  // BUGS dmulti(p, N): N (total count) is dropped because Stan's multinomial(theta)
  // only takes the probability simplex — N is implicit as sum(y) from the observed data.
  dmulti: {
    stanName: "multinomial",
    stanParamNames: ["theta"],
    transformParams: (params) => [params[0] || "theta"],
  },
  dlnorm: {
    stanName: "lognormal",
    stanParamNames: ["mu", "sigma"],
    transformParams: (params) => {
      const [mu, tau] = params;
      return [mu || "0", tau ? `1.0 / sqrt(${tau})` : "1"];
    },
  },
  dweib: {
    stanName: "weibull",
    stanParamNames: ["alpha", "sigma"],
    transformParams: (params) => {
      const [v, lambda] = params;
      const shape = v || "1";
      if (!lambda) return [shape, "1"];
      // JuliaBUGS dweib(a, b): scale = 1/b (Weibull(a, 1/b))
      return [shape, `1.0 / (${lambda})`];
    },
  },
  dchisqr: {
    stanName: "chi_square",
    stanParamNames: ["nu"],
    transformParams: (params) => [params[0] || "1"],
  },
  dnegbin: {
    stanName: "neg_binomial",
    stanParamNames: ["alpha", "beta"],
    transformParams: (params) => {
      const [p, r] = params;
      return [r || "1", p ? `${p} / (1.0 - ${p})` : "1"];
    },
  },
  // dgeom is intentionally not mapped: JuliaBUGS dgeom(p) is 1-based (P(X=x) = (1-p)^(x-1)*p,
  // x >= 1) while Stan's neg_binomial(1, p/(1-p)) is 0-based. The support shift requires
  // explicit likelihood adjustments in the generated code that are not yet implemented.
  dpar: {
    stanName: "pareto",
    stanParamNames: ["y_min", "alpha"],
    transformParams: (params) => {
      const [alpha, c] = params;
      return [c || "1", alpha || "1"];
    },
  },
  // BUGS ddexp(mu, tau): tau is precision-like (variance is 1/tau), scale b = 1/sqrt(tau).
  // Stan double_exponential(mu, sigma): sigma = scale = 1/sqrt(tau).
  ddexp: {
    stanName: "double_exponential",
    stanParamNames: ["mu", "sigma"],
    transformParams: (params) => {
      const [mu, tau] = params;
      return [mu || "0", tau ? `1.0 / sqrt(${tau})` : "1"];
    },
  },
  // BUGS dlogis(mu, tau): tau is precision-like (variance is 1/tau), scale s = 1/sqrt(tau).
  // Stan logistic(mu, sigma): sigma = scale = 1/sqrt(tau).
  dlogis: {
    stanName: "logistic",
    stanParamNames: ["mu", "s"],
    transformParams: (params) => {
      const [mu, tau] = params;
      return [mu || "0", tau ? `1.0 / sqrt(${tau})` : "1"];
    },
  },
};

// Map of BUGS distributions to which parameter positions (0-based) require int type.
// dbin(p, n): param index 1 (n) is int
// dnegbin(p, r): param index 1 (r) is int
const INT_PARAM_POSITIONS: Record<string, Set<number>> = {
  dbin: new Set([1]),
  dnegbin: new Set([1]),
  dhyper: new Set([0, 1, 2]),
};

const PARAM_KEYS = ["param1", "param2", "param3"] as const;

function findArrayIndexVarNames(nodes: GraphNode[], plates: GraphNode[]): Set<string> {
  const loopVars = new Set<string>();
  for (const p of plates) loopVars.add(p.loopVariable || "i");

  const indexVarNames = new Set<string>();
  for (const node of nodes) {
    if (node.nodeType === "plate") continue;
    for (const val of [
      node.equation,
      node.param1,
      node.param2,
      node.param3,
      node.censorLower,
      node.censorUpper,
    ]) {
      if (!val) continue;
      const expr = String(val);
      let i = 0;
      while (i < expr.length) {
        if (expr[i] === "[") {
          const start = i + 1;
          let j = start;
          while (j < expr.length && /[A-Za-z0-9_.]/.test(expr[j] as string)) j++;
          if (j > start) {
            const name = expr.substring(start, j);
            if (!loopVars.has(name) && /^[A-Za-z_]/.test(name)) {
              indexVarNames.add(name);
            }
          }
        }
        i++;
      }
    }
  }
  return indexVarNames;
}

function findIntegerConstants(nodes: GraphNode[]): Set<string> {
  const intConstants = new Set<string>();
  for (const node of nodes) {
    const dist = node.distribution;
    if (!dist) continue;
    const intPositions = INT_PARAM_POSITIONS[dist];
    if (!intPositions) continue;
    for (const pos of intPositions) {
      const key = PARAM_KEYS[pos];
      if (!key) continue;
      const raw = node[key] ? String(node[key]).trim() : "";
      if (!raw) continue;
      const baseName = raw.replace(/\[.*$/, "");
      if (/^[A-Za-z_][A-Za-z0-9_.]*$/.test(baseName)) {
        intConstants.add(baseName);
      }
    }
  }
  return intConstants;
}

function convertBugsName(name: string): string {
  return name.replace(/\./g, "_");
}

function convertExpression(expr: string): string {
  let result = expr.replace(/([a-zA-Z_][a-zA-Z0-9_]*)\.([a-zA-Z0-9_])/g, "$1_$2");
  result = result.replace(/\bloggam\b/g, "lgamma");
  // BUGS logfact(n) = log(n!) maps to Stan lgamma(n + 1) since lgamma(n+1) = log(n!)
  result = result.replace(/\blogfact\s*\(([^)]+)\)/g, "lgamma($1 + 1)");
  result = result.replace(/\bilogit\b/g, "inv_logit");
  result = result.replace(/\bphi\s*\(/g, "Phi(");
  result = result.replace(/\bprobit\s*\(/g, "inv_Phi(");
  result = result.replace(/\bcloglog\s*\(([^)]+)\)/g, "log(-log(1 - $1))");
  result = result.replace(/\bicloglog\s*\(([^)]+)\)/g, "1 - exp(-exp($1))");
  // cexpexp is not a standard BUGS function; mapped to the same formula as icloglog
  // (1 - exp(-exp(x))). Verify this matches your intended semantics.
  result = result.replace(/\bcexpexp\s*\(([^)]+)\)/g, "1 - exp(-exp($1))");
  result = result.replace(/\binprod\b/g, "dot_product");
  result = result.replace(/\bstep\s*\(([^)]+)\)/g, "($1 >= 0 ? 1 : 0)");
  result = result.replace(/\b_step\s*\(([^)]+)\)/g, "($1 >= 0 ? 1 : 0)");
  result = result.replace(/\bequals\(([^,]+),\s*([^)]+)\)/g, "($1 == $2 ? 1 : 0)");
  result = result.replace(/\blogdet\b/g, "log_determinant");
  result = result.replace(/\bmexp\b/g, "matrix_exp");
  result = result.replace(/\bsoftplus\b/g, "log1p_exp");
  // Replace BUGS `logistic(x)` link function with Stan `inv_logit(x)`.
  // Use a negative lookahead to avoid matching Stan distribution suffixes like logistic_lpdf.
  result = result.replace(/\blogistic\b(?!_)/g, "inv_logit");
  return result;
}

interface NodeClassification {
  stochasticParams: GraphNode[];
  deterministicNodes: GraphNode[];
  observedNodes: GraphNode[];
  constantNodes: GraphNode[];
  plates: GraphNode[];
}

interface DeterministicClassification {
  transformedData: GraphNode[];
  transformedParams: GraphNode[];
  generatedQuantities: GraphNode[];
}

function classifyDeterministicBlocks(
  deterministicNodes: GraphNode[],
  constantNodes: GraphNode[],
  observedNodes: GraphNode[],
  stochasticParams: GraphNode[],
  edges: GraphEdge[],
  nodeMap: Map<string, GraphNode>,
): DeterministicClassification {
  const dataNodeIds = new Set<string>();
  for (const n of constantNodes) dataNodeIds.add(n.id);
  for (const n of observedNodes) dataNodeIds.add(n.id);

  const inEdges = new Map<string, string[]>();
  for (const e of edges) {
    const list = inEdges.get(e.target);
    if (list) list.push(e.source);
    else inEdges.set(e.target, [e.source]);
  }

  const isDataOnly = new Map<string, boolean>();
  function checkDataOnly(nodeId: string): boolean {
    const cached = isDataOnly.get(nodeId);
    if (cached !== undefined) return cached;
    const node = nodeMap.get(nodeId);
    if (!node) return false;
    if (dataNodeIds.has(nodeId)) {
      isDataOnly.set(nodeId, true);
      return true;
    }
    if (node.nodeType === "stochastic" || node.nodeType !== "deterministic") {
      isDataOnly.set(nodeId, false);
      return false;
    }
    isDataOnly.set(nodeId, false);
    const parents = inEdges.get(nodeId) || [];
    const result = parents.every((pid) => checkDataOnly(pid));
    isDataOnly.set(nodeId, result);
    return result;
  }

  const reachesModel = new Set<string>();
  const modelNodeIds = new Set<string>();
  for (const n of stochasticParams) modelNodeIds.add(n.id);
  for (const n of observedNodes) modelNodeIds.add(n.id);

  function markReachesModel(nodeId: string) {
    if (reachesModel.has(nodeId)) return;
    reachesModel.add(nodeId);
    for (const pid of inEdges.get(nodeId) || []) markReachesModel(pid);
  }
  for (const mid of modelNodeIds) markReachesModel(mid);

  const transformedData: GraphNode[] = [];
  const transformedParams: GraphNode[] = [];
  const generatedQuantities: GraphNode[] = [];

  for (const node of deterministicNodes) {
    if (checkDataOnly(node.id)) {
      transformedData.push(node);
    } else if (reachesModel.has(node.id)) {
      transformedParams.push(node);
    } else {
      generatedQuantities.push(node);
    }
  }

  return { transformedData, transformedParams, generatedQuantities };
}

export interface PartialPlateParam {
  stanName: string;
  fullSize: number;
  plateStart: number;
  freeSize: number;
}

export function detectPartialPlateParams(elements: GraphElement[]): PartialPlateParam[] {
  const nodes = elements.filter((el): el is GraphNode => el.type === "node");
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const result: PartialPlateParam[] = [];
  for (const node of nodes) {
    if (node.nodeType !== "stochastic" || !node.parent) continue;
    const parentPlate = nodeMap.get(node.parent);
    if (parentPlate?.nodeType !== "plate") continue;
    const range = convertBugsName(parentPlate.loopRange || "1:N");
    const parts = range.split(":");
    if (parts.length !== 2) continue;
    const lower = Number.parseInt(parts[0] as string, 10);
    const upper = Number.parseInt(parts[1] as string, 10);
    if (Number.isNaN(lower) || Number.isNaN(upper) || lower <= 1) continue;
    result.push({
      stanName: convertBugsName(node.name),
      fullSize: upper,
      plateStart: lower,
      freeSize: upper - lower + 1,
    });
  }
  return result;
}

function classifyNodes(nodes: GraphNode[]): NodeClassification {
  const stochasticParams: GraphNode[] = [];
  const deterministicNodes: GraphNode[] = [];
  const observedNodes: GraphNode[] = [];
  const constantNodes: GraphNode[] = [];
  const plates: GraphNode[] = [];

  for (const node of nodes) {
    switch (node.nodeType) {
      case "stochastic":
        stochasticParams.push(node);
        break;
      case "observed":
        observedNodes.push(node);
        break;
      case "deterministic":
        deterministicNodes.push(node);
        break;
      case "constant":
        constantNodes.push(node);
        break;
      case "plate":
        plates.push(node);
        break;
    }
  }
  return { stochasticParams, deterministicNodes, observedNodes, constantNodes, plates };
}

function getPlateAncestors(node: GraphNode, nodeMap: Map<string, GraphNode>): GraphNode[] {
  const ancestors: GraphNode[] = [];
  let current = node;
  while (current.parent) {
    const parent = nodeMap.get(current.parent);
    if (parent && parent.nodeType === "plate") {
      ancestors.unshift(parent);
      current = parent;
    } else {
      break;
    }
  }
  return ancestors;
}

function getLoopDimensions(
  node: GraphNode,
  nodeMap: Map<string, GraphNode>,
): { variable: string; range: string }[] {
  const plates = getPlateAncestors(node, nodeMap);
  return plates.map((p) => ({
    variable: p.loopVariable || "i",
    range: convertBugsName(p.loopRange || "1:N"),
  }));
}

function getArrayDimsFromNode(
  node: GraphNode,
  nodeMap: Map<string, GraphNode>,
  allPlates: GraphNode[],
): string[] {
  const indices = node.indices?.trim();
  if (indices) {
    const varToUpper = new Map<string, string>();
    for (const plate of allPlates) {
      const loopVar = plate.loopVariable || "i";
      const range = convertBugsName(plate.loopRange || "1:N");
      const parts = range.split(":");
      const upper = parts.length === 2 ? (parts[1] as string).trim() : range;
      varToUpper.set(loopVar, upper);
    }
    const indexParts = indices.split(",").map((s) => s.trim());
    const dims: string[] = [];
    for (const idx of indexParts) {
      const upper = varToUpper.get(idx);
      if (upper) {
        dims.push(upper);
      } else if (!/^\d+$/.test(idx)) {
        // idx is not a loop variable and not a numeric literal (specific element index);
        // treat it directly as a dimension — it may be a data-size constant.
        dims.push(idx);
      }
    }
    return dims;
  }
  const plateDims = getLoopDimensions(node, nodeMap);
  return plateDims.map((d) => {
    const parts = d.range.split(":");
    return parts.length === 2 ? (parts[1] as string) : d.range;
  });
}

function inferMultivariateDim(node: GraphNode): string {
  const param1 = node.param1 ? String(node.param1).trim() : "";
  const dimMatch = param1.match(/\[1:(\w+)\]/) || param1.match(/\[(\d+)\]/);
  if (dimMatch) return dimMatch[1] as string;
  return "K";
}

function inferStanType(
  node: GraphNode,
  nodeMap: Map<string, GraphNode>,
  allPlates: GraphNode[],
): string {
  const dims = getArrayDimsFromNode(node, nodeMap, allPlates);
  const dist = node.distribution;

  let baseType = "real";
  if (
    dist === "dbern" ||
    dist === "dbin" ||
    dist === "dpois" ||
    dist === "dcat" ||
    dist === "dnegbin" ||
    dist === "dgeom" ||
    dist === "dhyper" ||
    dist === "dbetabin"
  ) {
    baseType = "int";
  }

  const mvDim = inferMultivariateDim(node);
  if (dist === "dmnorm" || dist === "dmt") baseType = `vector[${mvDim}]`;
  if (dist === "dwish") baseType = `matrix[${mvDim}, ${mvDim}]`;
  if (dist === "ddirich") baseType = `simplex[${mvDim}]`;
  if (dist === "dmulti") baseType = `array[${mvDim}] int`;

  if (dims.length > 0) {
    return `array[${dims.join(", ")}] ${baseType}`;
  }

  return baseType;
}

// null means dflat or no distribution — no sampling statement emitted
type FormatDistResult = { stanDist: string; stanParams: string } | { error: string } | null;

function formatStanDistribution(
  node: GraphNode,
  nameToNode: Map<string, GraphNode>,
): FormatDistResult {
  const dist = node.distribution;
  if (!dist || dist === "dflat") return null; // flat prior: intentionally no statement

  const mapping = DISTRIBUTION_MAP[dist];
  if (!mapping) {
    return { error: `'${dist}' has no Stan equivalent — sampling statement omitted` };
  }

  const rawParams = collectRawParams(node, nameToNode);
  const transformed = mapping.transformParams(rawParams, node);
  return { stanDist: mapping.stanName, stanParams: transformed.join(", ") };
}

function collectRawParams(node: GraphNode, nameToNode: Map<string, GraphNode>): string[] {
  // Always return exactly 3 positional entries (one per param slot) so that
  // transformParams destructuring gets the right value at each index regardless
  // of which earlier params are absent.
  return PARAM_KEYS.map((key) => {
    const val = node[key];
    const s = val ? String(val).trim() : "";
    return s ? formatStanParam(s, nameToNode) : "";
  });
}

function formatStanParam(raw: string, nameToNode: Map<string, GraphNode>): string {
  const p = raw.trim();
  if (!p) return p;
  if (/^[+-]?(?:\d+\.?\d*|\d*\.\d+)(?:[eE][+-]?\d+)?$/.test(p)) {
    return p;
  }
  if (/\[[^\]]+\]\s*$/.test(p)) return convertExpression(p);
  if (/[()]/.test(p)) {
    return convertExpression(p);
  }
  const ref = nameToNode.get(p);
  if (ref?.indices && String(ref.indices).trim() !== "") {
    return `${convertBugsName(p)}[${ref.indices}]`;
  }
  return convertBugsName(p);
}

function needsBoundsFromDistribution(
  dist: string | undefined,
  node: GraphNode,
  nameToNode: Map<string, GraphNode>,
): string {
  if (!dist) return "";
  switch (dist) {
    case "dgamma":
    case "dexp":
    case "dchisqr":
    case "dweib":
    case "dlnorm":
      return "<lower=0>";
    case "dpar": {
      // BUGS dpar(alpha, c): support is [c, inf). Use c (param2) as lower bound when available.
      // Strip any subscript (e.g. c[i]) — declaration bounds must be scalar expressions.
      const rawParams = collectRawParams(node, nameToNode);
      const c = rawParams[1] ? rawParams[1].replace(/\[.*$/, "") : "";
      return c ? `<lower=${c}>` : "<lower=0>";
    }
    case "dbeta":
      return "<lower=0, upper=1>";
    case "dunif": {
      // Strip any subscript — declaration bounds must be scalar expressions.
      const rawParams = collectRawParams(node, nameToNode);
      const lower = (rawParams[0] || "0").replace(/\[.*$/, "") || "0";
      const upper = (rawParams[1] || "1").replace(/\[.*$/, "") || "1";
      return `<lower=${lower}, upper=${upper}>`;
    }
    default:
      return "";
  }
}

// Scans all node expressions and params for identifiers that are not already
// declared as graph nodes, loop variables, or plate size variables.
// Returns them with their inferred Stan type (array dims if subscripted).
function findUndeclaredDataVars(
  nodes: GraphNode[],
  plateSizeVars: Set<string>,
): { stanName: string; dims: string[] }[] {
  const knownBugsNames = new Set<string>();
  const loopVars = new Set<string>();
  const loopVarToUpper = new Map<string, string>();

  for (const n of nodes) {
    if (n.nodeType === "plate") {
      const lv = n.loopVariable || "i";
      loopVars.add(lv);
      const range = convertBugsName(n.loopRange || "1:N");
      const parts = range.split(":");
      const upper = parts.length === 2 ? (parts[1] as string).trim() : range;
      loopVarToUpper.set(lv, upper);
    } else {
      knownBugsNames.add(n.name);
    }
  }

  const allExprs: string[] = [];
  for (const n of nodes) {
    if (n.nodeType === "plate") continue;
    for (const val of [n.equation, n.param1, n.param2, n.param3, n.censorLower, n.censorUpper]) {
      if (val) allExprs.push(String(val));
    }
  }

  // Match dotted-identifiers (BUGS names) optionally followed by [subscript].
  // The lookbehind (?<![0-9.]) prevents matching the exponent letter in numeric
  // literals like 1.0E-4 where E is preceded by a digit.
  const IDENT_RE = /(?<![0-9.])([A-Za-z_][A-Za-z0-9_.]*)(\s*)(\[([^\]]*)\])?/g;
  const undeclared = new Map<string, Set<string>>();

  for (const expr of allExprs) {
    IDENT_RE.lastIndex = 0;
    let match: RegExpExecArray | null = IDENT_RE.exec(expr);
    while (match !== null) {
      const bugsName = match[1] as string;
      const subscript = match[4]?.trim();
      const charAfterIdent = expr.charAt(match.index + bugsName.length);

      const skip =
        // Skip function calls (identifier immediately followed by '(')
        charAfterIdent === "(" ||
        // Skip loop variable bare names
        loopVars.has(bugsName) ||
        // Skip known graph node names (dotted, as-is from JSON)
        knownBugsNames.has(bugsName) ||
        // Skip numeric tokens
        /^\d/.test(bugsName);

      if (!skip) {
        const stanName = convertBugsName(bugsName);
        if (!plateSizeVars.has(stanName) && !loopVars.has(stanName)) {
          let dimsSet = undeclared.get(stanName);
          if (!dimsSet) {
            dimsSet = new Set();
            undeclared.set(stanName, dimsSet);
          }
          if (subscript) {
            for (const sub of subscript.split(",").map((s) => s.trim())) {
              const upper = loopVarToUpper.get(sub);
              if (upper) dimsSet.add(upper);
            }
          }
        }
      }
      match = IDENT_RE.exec(expr);
    }
  }

  return [...undeclared.entries()].map(([stanName, dimsSet]) => ({
    stanName,
    dims: [...dimsSet],
  }));
}

// Distributions that cannot be vectorized in Stan (multivariate / non-scalar support)
const NON_VECTORIZABLE_DISTS = new Set(["dmnorm", "dmt", "dwish", "ddirich", "dmulti"]);

const ANALYZE_OPTS = {
  canTranslate: (dist: string) => DISTRIBUTION_MAP[dist] !== undefined,
};

// Given a raw BUGS param string and the current plate's loop variable, attempt to strip
// the loop-variable index so the expression works on the whole array.
// Returns null if the param depends on the loop var in a non-strippable way.
function stripLoopVarFromParam(
  raw: string,
  plateVar: string,
  nameToNode: Map<string, GraphNode>,
): string | null {
  const p = raw.trim();

  // Numeric literal — safe to broadcast
  if (/^[+-]?(?:\d+\.?\d*|\d*\.\d+)(?:[eE][+-]?\d+)?$/.test(p)) return p;

  // name[exactly plateVar] -> name (strip the index)
  const singleIdxRe = /^([A-Za-z_][A-Za-z0-9_.]*)\[([^\]]+)\]$/;
  const m = singleIdxRe.exec(p);
  if (m) {
    const idx = (m[2] as string).trim();
    if (idx === plateVar) return convertBugsName(m[1] as string);
    // Any other subscript (multi-index, different var) -> can't vectorize
    return null;
  }

  // If the loop variable appears bare anywhere in the expression, can't vectorize
  const bareVarRe = new RegExp(`\\b${plateVar}\\b`);
  if (bareVarRe.test(p)) return null;

  // Expression with operators/functions but no loop var -> convert and keep as-is
  if (/[()/*+-]/.test(p)) return convertExpression(p);

  // Simple dotted identifier — look up to confirm it's not a multi-dim node
  if (/^[A-Za-z_][A-Za-z0-9_.]*$/.test(p)) {
    const ref = nameToNode.get(p);
    if (ref?.indices) {
      const refParts = ref.indices.split(",").map((s) => s.trim());
      // If this node has >1 index dimension it can't be broadcast safely
      if (refParts.length > 1) return null;
    }
    return convertBugsName(p);
  }

  return null;
}

// Try to produce a vectorized sampling statement for a node inside a single plate.
// Returns the statement string (no trailing newline) or null if vectorization is not safe.
function tryVectorizeNode(
  node: GraphNode,
  plateVar: string,
  indent: string,
  nameToNode: Map<string, GraphNode>,
): string | null {
  // Can't vectorize censored or hybrid (equation) nodes
  if (node.censorLower || node.censorUpper) return null;
  if (node.equation) return null;

  const dist = node.distribution;
  if (!dist || NON_VECTORIZABLE_DISTS.has(dist)) return null;

  // Discrete latent parameters can't be sampled in Stan at all — keep them in the
  // loop so the "discrete latent variable" warning comment is emitted there.
  if (node.nodeType === "stochastic" && DISCRETE_DISTRIBUTIONS.has(dist)) return null;

  // Node must be indexed by exactly this single loop variable
  const idxParts = (node.indices || "").trim()
    ? (node.indices || "").split(",").map((s) => s.trim())
    : [];
  if (idxParts.length !== 1 || idxParts[0] !== plateVar) return null;

  const stanName = convertBugsName(node.name);
  // Preserve positional slots (empty string for absent params) so that
  // transformParams destructuring receives values at the correct indices,
  // matching the behaviour of collectRawParams.
  const rawParams = PARAM_KEYS.map((k) => {
    const val = node[k];
    return val ? String(val).trim() : "";
  });

  const strippedParams: string[] = [];
  for (const raw of rawParams) {
    if (!raw) {
      strippedParams.push("");
      continue;
    }
    const stripped = stripLoopVarFromParam(raw, plateVar, nameToNode);
    if (stripped === null) return null;
    strippedParams.push(stripped);
  }

  const mapping = DISTRIBUTION_MAP[dist];
  const stanDist = mapping?.stanName ?? dist;
  const stanParams = mapping
    ? mapping.transformParams(strippedParams, node).join(", ")
    : strippedParams.join(", ");

  return `${indent}${stanName} ~ ${stanDist}(${stanParams});`;
}

// Matrix-producing Stan functions: their result is a matrix/vector, not a scalar.
const MATRIX_RESULT_FUNCTIONS =
  /\b(inverse|matrix_exp|crossprod|tcrossprod|diag_matrix|rep_matrix|append_col|append_row|cholesky_decompose|quad_form|mdivide_left|mdivide_right)\s*\(/;

const MULTIVARIATE_DISTS = new Set(["dmnorm", "dmt", "dwish", "ddirich", "dmulti"]);

function nodeEquationHasMatrixResult(node: GraphNode, nameToNode: Map<string, GraphNode>): boolean {
  const eq = node.equation ? String(node.equation) : "";
  if (MATRIX_RESULT_FUNCTIONS.test(eq)) return true;
  // Also flag if any referenced variable has a multivariate distribution
  const identRe = /[A-Za-z_][A-Za-z0-9_.]*/g;
  let m: RegExpExecArray | null = identRe.exec(eq);
  while (m !== null) {
    const ref = nameToNode.get(m[0]);
    if (ref?.distribution && MULTIVARIATE_DISTS.has(ref.distribution)) return true;
    m = identRe.exec(eq);
  }
  return false;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function densityTerm(
  node: GraphNode,
  nameToNode: Map<string, GraphNode>,
  target?: string,
): string | null {
  const info = formatStanDistribution(node, nameToNode);
  if (info === null || "error" in info) return null;
  const dist = node.distribution ?? "";
  const suffix = DISCRETE_DISTRIBUTIONS.has(dist) || dist === "dmulti" ? "lpmf" : "lpdf";
  const lhs = target ?? `${convertBugsName(node.name)}${node.indices ? `[${node.indices}]` : ""}`;
  return `${info.stanDist}_${suffix}(${lhs} | ${info.stanParams})`;
}

function inlineDetRefs(term: string, dets: GraphNode[], depth = 0): string {
  if (depth > 8 || dets.length === 0) return term;
  let out = term;
  for (const d of dets) {
    const eq = `(${convertExpression(String(d.equation ?? ""))})`;
    const name = escapeRe(convertBugsName(d.name));
    const idx = d.indices?.trim();
    const re = idx
      ? new RegExp(`(?<![A-Za-z0-9_])${name}\\s*\\[\\s*${escapeRe(idx)}\\s*\\]`, "g")
      : new RegExp(`(?<![A-Za-z0-9_])${name}(?![A-Za-z0-9_])`, "g");
    out = out.replace(re, eq);
  }
  return out === term ? out : inlineDetRefs(out, dets, depth + 1);
}

function substLatentRef(
  term: string,
  latentName: string,
  loopVar: string | null,
  valExpr: string,
): string {
  const name = escapeRe(latentName);
  const re = loopVar
    ? new RegExp(`(?<![A-Za-z0-9_])${name}\\s*\\[\\s*${escapeRe(loopVar)}\\s*\\]`, "g")
    : new RegExp(`(?<![A-Za-z0-9_])${name}(?![A-Za-z0-9_])`, "g");
  return term.replace(re, valExpr);
}

// dcat loops support values directly; dbern loops 1-based positions with a shifted value.
function latentLoopVars(latent: GraphNode, support: SupportInfo) {
  const stanName = convertBugsName(latent.name);
  if (support.lo === 1) {
    const v = `${stanName}_val`;
    return { posVar: v, valExpr: v, valDecl: null as string | null };
  }
  const pos = `${stanName}_idx`;
  const val = `${stanName}_val`;
  const shift = support.lo - 1;
  const offset = shift >= 0 ? `+ ${shift}` : `- ${-shift}`;
  return { posVar: pos, valExpr: val, valDecl: `int ${val} = ${pos} ${offset};` };
}

function plateUpper(plate: GraphNode): string {
  const range = convertBugsName(plate.loopRange || "1:N");
  const parts = range.split(":");
  return parts.length === 2 ? (parts[1] as string).trim() : range;
}

function plateTerms(plan: PlatePlan, nameToNode: Map<string, GraphNode>): string[] {
  const loopVar = plan.plate.loopVariable || "i";
  const { valExpr } = latentLoopVars(plan.latent, plan.support);
  const terms: string[] = [];
  const prior = densityTerm(plan.latent, nameToNode, valExpr);
  if (prior) terms.push(prior);
  for (const f of plan.factors) {
    const raw = densityTerm(f, nameToNode);
    if (!raw) continue;
    const inlined = inlineDetRefs(raw, plan.inlineDets);
    terms.push(substLatentRef(inlined, plan.latent.name, loopVar, valExpr));
  }
  return terms;
}

function sumLines(lhs: string, terms: string[], indent: string): string[] {
  const [first, ...rest] = terms;
  const lines = [`${indent}${lhs} = ${first ?? "0"}${rest.length === 0 ? ";" : ""}`];
  rest.forEach((t, i) => {
    lines.push(`${indent}  + ${t}${i === rest.length - 1 ? ";" : ""}`);
  });
  return lines;
}

function emitPlateMarginalization(
  plan: PlatePlan,
  indent: string,
  nameToNode: Map<string, GraphNode>,
): string[] {
  const stanName = convertBugsName(plan.latent.name);
  const { posVar, valDecl } = latentLoopVars(plan.latent, plan.support);
  const acc = `${stanName}_lp`;
  const terms = plateTerms(plan, nameToNode);
  const lines = [
    `${indent}// marginalize out ${stanName}[${plan.plate.loopVariable || "i"}]`,
    `${indent}{`,
    `${indent}  vector[${plan.support.size}] ${acc};`,
    `${indent}  for (${posVar} in 1:${plan.support.size}) {`,
  ];
  if (valDecl) lines.push(`${indent}    ${valDecl}`);
  lines.push(...sumLines(`${acc}[${posVar}]`, terms, `${indent}    `));
  lines.push(`${indent}  }`, `${indent}  target += log_sum_exp(${acc});`, `${indent}}`);
  return lines;
}

function emitPlateRecovery(
  plan: PlatePlan,
  nameToNode: Map<string, GraphNode>,
): { decl: string; lines: string[] } {
  const stanName = convertBugsName(plan.latent.name);
  const loopVar = plan.plate.loopVariable || "i";
  const upper = plateUpper(plan.plate);
  const { posVar, valDecl } = latentLoopVars(plan.latent, plan.support);
  const acc = `${stanName}_lp`;
  const terms = plateTerms(plan, nameToNode);
  const delta = plan.support.lo - 1;
  const shift = delta === 0 ? "" : delta > 0 ? ` + ${delta}` : ` - ${-delta}`;
  const lines = [
    `  // recover ${stanName} from its conditional posterior`,
    `  for (${loopVar} in 1:${upper}) {`,
    `    vector[${plan.support.size}] ${acc};`,
    `    for (${posVar} in 1:${plan.support.size}) {`,
  ];
  if (valDecl) lines.push(`      ${valDecl}`);
  lines.push(...sumLines(`${acc}[${posVar}]`, terms, "      "));
  lines.push(
    "    }",
    `    ${stanName}[${loopVar}] = categorical_rng(softmax(${acc}))${shift};`,
    "  }",
  );
  return { decl: `  array[${upper}] int ${stanName};`, lines };
}

interface ScalarNaming {
  vars: Map<string, ReturnType<typeof latentLoopVars>>;
  supports: Map<string, SupportInfo>;
  phiScopes: Map<string, GraphNode[]>;
}

function scalarNaming(plan: ScalarDagPlan): ScalarNaming {
  const vars = new Map<string, ReturnType<typeof latentLoopVars>>();
  const supports = new Map<string, SupportInfo>();
  for (const step of plan.steps) {
    vars.set(step.latent.id, latentLoopVars(step.latent, step.support));
    supports.set(step.latent.id, step.support);
  }
  return { vars, supports, phiScopes: new Map() };
}

function scalarBucketTerms(
  step: ScalarDagPlan["steps"][number],
  plan: ScalarDagPlan,
  naming: ScalarNaming,
  nameToNode: Map<string, GraphNode>,
): string[] {
  const inScope = [step.latent, ...step.scopeAfter];
  const substAll = (raw: string): string => {
    let out = inlineDetRefs(raw, plan.inlineDets);
    for (const l of inScope) {
      out = substLatentRef(out, l.name, null, naming.vars.get(l.id)?.valExpr ?? l.name);
    }
    return out;
  };
  const terms: string[] = [];
  for (const f of step.bucketFactors) {
    // A latent node in the bucket stands for its own prior, scored at its value var.
    const raw = densityTerm(f, nameToNode, naming.vars.get(f.id)?.valExpr);
    if (raw) terms.push(substAll(raw));
  }
  for (const phi of step.bucketPhis) {
    const scope = naming.phiScopes.get(phi.id) ?? [];
    const idx = scope.map((l) => naming.vars.get(l.id)?.posVar ?? "1").join(", ");
    terms.push(`phi_${convertBugsName(phi.name)}[${idx}]`);
  }
  return terms;
}

function emitScalarElimination(plan: ScalarDagPlan, nameToNode: Map<string, GraphNode>): string[] {
  const naming = scalarNaming(plan);
  const decls: string[] = [];
  const body: string[] = [];

  for (const step of plan.steps) {
    const stanName = convertBugsName(step.latent.name);
    const { posVar, valDecl } = naming.vars.get(step.latent.id) as ReturnType<
      typeof latentLoopVars
    >;
    const acc = `${stanName}_lp`;
    const terms = scalarBucketTerms(step, plan, naming, nameToNode);
    body.push(`    // eliminate ${stanName}`);

    let indent = "    ";
    for (const outer of step.scopeAfter) {
      const ov = naming.vars.get(outer.id) as ReturnType<typeof latentLoopVars>;
      const size = naming.supports.get(outer.id)?.size ?? "1";
      body.push(`${indent}for (${ov.posVar} in 1:${size}) {`);
      indent += "  ";
      if (ov.valDecl) body.push(`${indent}${ov.valDecl}`);
    }

    body.push(`${indent}vector[${step.support.size}] ${acc};`);
    body.push(`${indent}for (${posVar} in 1:${step.support.size}) {`);
    if (valDecl) body.push(`${indent}  ${valDecl}`);
    body.push(...sumLines(`${acc}[${posVar}]`, terms, `${indent}  `));
    body.push(`${indent}}`);

    if (step.scopeAfter.length === 0) {
      body.push(`${indent}target += log_sum_exp(${acc});`);
    } else {
      const dims = step.scopeAfter.map((l) => naming.supports.get(l.id)?.size ?? "1").join(", ");
      decls.push(`    array[${dims}] real phi_${stanName};`);
      const idx = step.scopeAfter.map((l) => naming.vars.get(l.id)?.posVar ?? "1").join(", ");
      body.push(`${indent}phi_${stanName}[${idx}] = log_sum_exp(${acc});`);
      naming.phiScopes.set(step.latent.id, step.scopeAfter);
    }

    for (let i = step.scopeAfter.length; i > 0; i--) {
      indent = indent.slice(2);
      body.push(`${indent}}`);
    }
  }

  return [
    "  // marginalize scalar discrete latents by variable elimination",
    "  {",
    ...decls,
    ...body,
    "  }",
  ];
}

function emitScalarRecovery(
  plan: ScalarDagPlan,
  nameToNode: Map<string, GraphNode>,
): { decls: string[]; lines: string[] } {
  const naming = scalarNaming(plan);
  const substAll = (raw: string): string => {
    let out = inlineDetRefs(raw, plan.inlineDets);
    for (const l of plan.latents) {
      out = substLatentRef(out, l.name, null, naming.vars.get(l.id)?.valExpr ?? l.name);
    }
    return out;
  };
  const terms: string[] = [];
  for (const l of plan.latents) {
    const prior = densityTerm(l, nameToNode, naming.vars.get(l.id)?.valExpr);
    if (prior) terms.push(substAll(prior));
  }
  for (const f of plan.factors) {
    const raw = densityTerm(f, nameToNode);
    if (raw) terms.push(substAll(raw));
  }

  const sizes = plan.latents.map((l) => naming.supports.get(l.id)?.size ?? "1");
  const numericSizes = sizes.map(Number);
  if (numericSizes.every(Number.isFinite)) {
    const cost = numericSizes.reduce((a, b) => a * b, 1);
    if (cost > FRONTIER_COST_WARN) {
      return {
        decls: [],
        lines: [`  // latent recovery skipped: joint enumeration of ${cost} configurations`],
      };
    }
  }
  const total = sizes.join(" * ");
  const decls = plan.latents.map((l) => `  int ${convertBugsName(l.name)};`);
  const lines: string[] = [
    "  // recover the scalar discrete latents from their joint conditional posterior",
    "  {",
    `    vector[${total}] marg_joint_lp;`,
    ...plan.latents.map((l) => `    array[${total}] int marg_conf_${convertBugsName(l.name)};`),
    "    int marg_c = 0;",
    "    int marg_pick;",
  ];
  let indent = "    ";
  for (const l of plan.latents) {
    const v = naming.vars.get(l.id) as ReturnType<typeof latentLoopVars>;
    lines.push(`${indent}for (${v.posVar} in 1:${naming.supports.get(l.id)?.size ?? "1"}) {`);
    indent += "  ";
    if (v.valDecl) lines.push(`${indent}${v.valDecl}`);
  }
  lines.push(`${indent}marg_c += 1;`);
  lines.push(...sumLines("marg_joint_lp[marg_c]", terms, indent));
  for (const l of plan.latents) {
    const v = naming.vars.get(l.id) as ReturnType<typeof latentLoopVars>;
    lines.push(`${indent}marg_conf_${convertBugsName(l.name)}[marg_c] = ${v.valExpr};`);
  }
  for (let i = plan.latents.length; i > 0; i--) {
    indent = indent.slice(2);
    lines.push(`${indent}}`);
  }
  lines.push("    marg_pick = categorical_rng(softmax(marg_joint_lp));");
  for (const l of plan.latents) {
    const n = convertBugsName(l.name);
    lines.push(`    ${n} = marg_conf_${n}[marg_pick];`);
  }
  lines.push("  }");
  return { decls, lines };
}

// Data arrays indexed by a latent (e.g. muX[X], deltaC[C + 1], P[Z, 1:2]) need the
// latent's support size as their dimension; nothing else in the graph carries it.
function latentIndexedDataDims(
  analysis: DiscreteAnalysis,
  loopVarToUpper: Map<string, string>,
): Map<string, string[]> {
  const latentSize = new Map<string, string>();
  const exprNodes: GraphNode[] = [];
  for (const l of analysis.latents) {
    if (l.tier === "unsupported" || !l.support) continue;
    latentSize.set(l.node.name, l.support.size);
    exprNodes.push(l.node);
  }
  if (latentSize.size === 0) return new Map();
  for (const plan of analysis.platePlans) exprNodes.push(...plan.factors, ...plan.inlineDets);
  if (analysis.scalarPlan) {
    exprNodes.push(...analysis.scalarPlan.factors, ...analysis.scalarPlan.inlineDets);
  }

  const resolveSub = (sub: string): string => {
    const latent = [...latentSize.keys()].find((n) =>
      new RegExp(`(?<![A-Za-z0-9_])${escapeRe(n)}(?![A-Za-z0-9_])`).test(sub),
    );
    if (latent) return latentSize.get(latent) as string;
    const upper = loopVarToUpper.get(sub);
    if (upper) return upper;
    const range = sub.match(/^(\S+)\s*:\s*(\S+)$/);
    if (range) {
      if (range[1] === "1" || /^\d+$/.test(range[2] as string)) return range[2] as string;
      return "";
    }
    if (/^\d+$/.test(sub)) return sub;
    return "";
  };

  const dims = new Map<string, string[]>();
  const INDEXED_RE = /(?<![0-9.])([A-Za-z_][A-Za-z0-9_.]*)\s*\[([^\][]*(?:\[[^\]]*\][^\][]*)*)\]/g;
  for (const node of exprNodes) {
    for (const expr of [node.equation, node.param1, node.param2, node.param3]) {
      if (!expr) continue;
      INDEXED_RE.lastIndex = 0;
      let m: RegExpExecArray | null = INDEXED_RE.exec(String(expr));
      while (m !== null) {
        const base = m[1] as string;
        const subs = splitTopLevel(m[2] as string);
        const resolved = subs.map(resolveSub);
        const hasLatent = subs.some((sub) =>
          [...latentSize.keys()].some((n) =>
            new RegExp(`(?<![A-Za-z0-9_])${escapeRe(n)}(?![A-Za-z0-9_])`).test(sub),
          ),
        );
        if (hasLatent && resolved.every((d) => d !== "")) {
          dims.set(convertBugsName(base), resolved);
        }
        m = INDEXED_RE.exec(String(expr));
      }
    }
  }
  return dims;
}

function splitTopLevel(subs: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of subs) {
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

// The probability argument of categorical_lpmf must be vector-typed, so the
// prior vectors of marginalized dcat latents override the default real arrays.
// A prior indexed by another latent (theta[X, 1:2]) becomes an array of vectors.
function catPriorVectorOverrides(analysis: DiscreteAnalysis): Map<string, string> {
  const latentSize = new Map(
    analysis.latents
      .filter((l) => l.tier !== "unsupported" && l.support)
      .map((l) => [l.node.name, (l.support as SupportInfo).size]),
  );
  const overrides = new Map<string, string>();
  for (const l of analysis.latents) {
    if (l.tier === "unsupported" || l.node.distribution !== "dcat" || !l.support) continue;
    const p1 = String(l.node.param1 ?? "").trim();
    const plain = p1.match(/^([A-Za-z_][A-Za-z0-9_.]*)\s*(?:\[\s*(?::|1\s*:\s*[^\]]+)?\s*\])?$/);
    if (plain) {
      overrides.set(convertBugsName(plain[1] as string), `vector[${l.support.size}]`);
      continue;
    }
    // A numeric slice w[a:b] declares the vector up to its upper bound.
    const slice = p1.match(/^([A-Za-z_][A-Za-z0-9_.]*)\s*\[\s*\d+\s*:\s*(\d+)\s*\]$/);
    if (slice) {
      overrides.set(convertBugsName(slice[1] as string), `vector[${slice[2]}]`);
      continue;
    }
    const rowIndexed = p1.match(
      /^([A-Za-z_][A-Za-z0-9_.]*)\s*\[\s*([A-Za-z_][A-Za-z0-9_]*)\s*,\s*1\s*:\s*([^\]]+?)\s*\]$/,
    );
    if (rowIndexed) {
      const rowDim = latentSize.get(rowIndexed[2] as string);
      if (rowDim) {
        overrides.set(
          convertBugsName(rowIndexed[1] as string),
          `array[${rowDim}] vector[${rowIndexed[3]}]`,
        );
      }
    }
  }
  return overrides;
}

/** Generate Stan model code from a DoodleBUGS graph. */
export function generateStanModel(elements: GraphElement[]): string {
  const nodes = elements.filter((el): el is GraphNode => el.type === "node");
  const edges = elements.filter((el): el is GraphEdge => el.type === "edge");
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const nameToNode = new Map(nodes.map((n) => [n.name, n]));

  if (nodes.length === 0) {
    return "// Empty model\n";
  }

  const { stochasticParams, deterministicNodes, observedNodes, constantNodes, plates } =
    classifyNodes(nodes);
  const topoOrder = buildTopologicalOrder(nodes, edges);
  const topoIndex = new Map(topoOrder.map((id, i) => [id, i]));

  const marg = analyzeDiscreteLatents(elements, topoOrder, ANALYZE_OPTS);
  const margLatentIds = new Set(
    marg.latents.filter((l) => l.tier !== "unsupported").map((l) => l.node.id),
  );
  const margReasons = new Map(
    marg.latents
      .filter((l) => l.tier === "unsupported" && l.reason)
      .map((l) => [l.node.id, l.reason as string]),
  );
  const platePlanByLatent = new Map(marg.platePlans.map((p) => [p.latent.id, p]));
  const consumedFactorIds = new Set(
    [...marg.consumedFactorIds].filter((id) => !margLatentIds.has(id)),
  );
  const plateUppers = new Map<string, string>();
  for (const n of nodes) {
    if (n.nodeType !== "plate") continue;
    const parts = convertBugsName(n.loopRange || "1:N").split(":");
    if (parts.length === 2) plateUppers.set(n.loopVariable || "i", (parts[1] as string).trim());
  }
  const latentDims = latentIndexedDataDims(marg, plateUppers);

  const sortByTopo = (a: GraphNode, b: GraphNode) =>
    (topoIndex.get(a.id) ?? 0) - (topoIndex.get(b.id) ?? 0);

  const dataDeclarations: string[] = [];
  const parameterDeclarations: string[] = [];
  const transformedParamLines: string[] = [];

  const mvTypeOverrides = catPriorVectorOverrides(marg);
  // Don't override types for names that already correspond to stochastic or deterministic
  // nodes — those are handled by their own declaration loops using inferStanType / per-dist
  // logic. Overriding them here could mis-type a shared base name (e.g. mu[i] stripped to
  // mu) whose declaration is already correct.
  const nonDataNodeStanNames = new Set<string>([
    ...stochasticParams.map((n) => convertBugsName(n.name)),
    ...deterministicNodes.map((n) => convertBugsName(n.name)),
  ]);
  const mvDistNodes = [...stochasticParams, ...observedNodes];
  for (const node of mvDistNodes) {
    const dist = node.distribution;
    if (!dist) continue;
    const mvDim = inferMultivariateDim(node);
    const p1 = node.param1 ? String(node.param1).trim().replace(/\[.*$/, "") : "";
    const p2 = node.param2 ? String(node.param2).trim().replace(/\[.*$/, "") : "";
    const p1Stan = p1 ? convertBugsName(p1) : "";
    const p2Stan = p2 ? convertBugsName(p2) : "";
    if (dist === "dmnorm" || dist === "dmt") {
      if (p1Stan && !nonDataNodeStanNames.has(p1Stan))
        mvTypeOverrides.set(p1Stan, `vector[${mvDim}]`);
      if (p2Stan && !nonDataNodeStanNames.has(p2Stan))
        mvTypeOverrides.set(p2Stan, `matrix[${mvDim}, ${mvDim}]`);
    } else if (dist === "dwish") {
      if (p1Stan && !nonDataNodeStanNames.has(p1Stan))
        mvTypeOverrides.set(p1Stan, `matrix[${mvDim}, ${mvDim}]`);
    } else if (dist === "ddirich") {
      if (p1Stan && !nonDataNodeStanNames.has(p1Stan))
        mvTypeOverrides.set(p1Stan, `vector[${mvDim}]`);
    } else if (dist === "dmulti") {
      if (p1Stan && !nonDataNodeStanNames.has(p1Stan))
        mvTypeOverrides.set(p1Stan, `simplex[${mvDim}]`);
    }
  }

  const plateSizeVars = new Set<string>();
  for (const plate of plates) {
    const range = plate.loopRange || "";
    const converted = convertBugsName(range);
    const parts = converted.split(":");
    if (parts.length === 2) {
      const upper = (parts[1] as string).trim();
      if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(upper)) {
        plateSizeVars.add(upper);
      }
    }
  }
  for (const v of plateSizeVars) {
    dataDeclarations.push(`  int<lower=1> ${v};`);
  }

  const intConstantNames = findIntegerConstants(nodes);
  const arrayIndexVarNames = findArrayIndexVarNames(nodes, plates);

  for (const node of constantNodes.sort(sortByTopo)) {
    const stanName = convertBugsName(node.name);
    const ownDims = getArrayDimsFromNode(node, nodeMap, plates);
    const dims = ownDims.length > 0 ? ownDims : (latentDims.get(stanName) ?? ownDims);
    const mvType = mvTypeOverrides.get(stanName);
    if (mvType) {
      if (dims.length > 0 && !mvType.startsWith("array[")) {
        dataDeclarations.push(`  array[${dims.join(", ")}] ${mvType} ${stanName};`);
      } else {
        dataDeclarations.push(`  ${mvType} ${stanName};`);
      }
    } else {
      const isInt =
        intConstantNames.has(node.name) ||
        arrayIndexVarNames.has(node.name) ||
        arrayIndexVarNames.has(stanName);
      const baseType = isInt ? "int" : "real";
      if (dims.length > 0) {
        dataDeclarations.push(`  array[${dims.join(", ")}] ${baseType} ${stanName};`);
      } else {
        dataDeclarations.push(`  ${baseType} ${stanName};`);
      }
    }
  }

  for (const node of observedNodes.sort(sortByTopo)) {
    const stanName = convertBugsName(node.name);
    const stanType = inferStanType(node, nodeMap, plates);
    dataDeclarations.push(`  ${stanType} ${stanName};`);

    const cl = node.censorLower ? String(node.censorLower).trim() : "";
    const cu = node.censorUpper ? String(node.censorUpper).trim() : "";
    if (cl || cu) {
      const dims = getArrayDimsFromNode(node, nodeMap, plates);
      const boundNames = new Set<string>();
      for (const bound of [cl, cu]) {
        if (!bound) continue;
        const rawBoundName = bound.replace(/\[.*$/, "");
        boundNames.add(convertBugsName(rawBoundName));
      }
      for (const stanBoundName of boundNames) {
        if (dims.length > 0) {
          dataDeclarations.push(`  array[${dims.join(", ")}] real ${stanBoundName};`);
        } else {
          dataDeclarations.push(`  real ${stanBoundName};`);
        }
      }
      if (dims.length > 0) {
        dataDeclarations.push(`  array[${dims.join(", ")}] int ${stanName}_is_obs;`);
      } else {
        dataDeclarations.push(`  int ${stanName}_is_obs;`);
      }
    }
  }

  // Detect any identifiers used in equations/params that are not graph nodes.
  // These are external data covariates (e.g. Base[j], Trt[j], log.Base4.bar).
  const alreadyDeclared = new Set(
    dataDeclarations.map((d) => (d.trim().split(/\s+/).pop() ?? "").replace(";", "")),
  );
  for (const { stanName, dims: foundDims } of findUndeclaredDataVars(nodes, plateSizeVars)) {
    if (alreadyDeclared.has(stanName)) continue;
    const dims = foundDims.length > 0 ? foundDims : (latentDims.get(stanName) ?? foundDims);
    const mvType = mvTypeOverrides.get(stanName);
    if (mvType) {
      if (dims.length > 0 && !mvType.startsWith("array[")) {
        dataDeclarations.push(`  array[${dims.join(", ")}] ${mvType} ${stanName};`);
      } else {
        dataDeclarations.push(`  ${mvType} ${stanName};`);
      }
    } else {
      const bugsName = stanName.replace(/_/g, ".");
      const isInt =
        intConstantNames.has(bugsName) ||
        intConstantNames.has(stanName) ||
        arrayIndexVarNames.has(bugsName) ||
        arrayIndexVarNames.has(stanName);
      const baseType = isInt ? "int" : "real";
      if (dims.length > 0) {
        dataDeclarations.push(`  array[${dims.join(", ")}] ${baseType} ${stanName};`);
      } else {
        dataDeclarations.push(`  ${baseType} ${stanName};`);
      }
    }
    alreadyDeclared.add(stanName);
  }

  const partialPlateParams = detectPartialPlateParams(elements);
  const partialPlateMap = new Map(partialPlateParams.map((p) => [p.stanName, p]));

  // Detect stochastic params in plates with lower > 1 but a non-literal upper bound.
  // detectPartialPlateParams skips these, so they fall through to normal declarations
  // which may produce incorrect Stan code — warn the user.
  const partialPlateWarningNames = new Set<string>();
  for (const node of stochasticParams) {
    if (!node.parent) continue;
    const parentPlate = nodeMap.get(node.parent);
    if (parentPlate?.nodeType !== "plate") continue;
    const range = convertBugsName(parentPlate.loopRange || "1:N");
    const parts = range.split(":");
    if (parts.length !== 2) continue;
    const lower = Number.parseInt(parts[0] as string, 10);
    if (Number.isNaN(lower) || lower <= 1) continue;
    const stanName = convertBugsName(node.name);
    if (!partialPlateMap.has(stanName)) {
      partialPlateWarningNames.add(stanName);
    }
  }

  for (const node of stochasticParams.sort(sortByTopo)) {
    if (margLatentIds.has(node.id)) continue;
    const stanName = convertBugsName(node.name);
    const dims = getArrayDimsFromNode(node, nodeMap, plates);
    const bounds = needsBoundsFromDistribution(node.distribution, node, nameToNode);
    const ppInfo = partialPlateMap.get(stanName);

    if (ppInfo) {
      parameterDeclarations.push(`  array[${ppInfo.freeSize}] real${bounds} ${stanName}_free;`);
      transformedParamLines.push(`  array[${ppInfo.fullSize}] real ${stanName};`);
      // Indices 1..(plateStart-1) are outside the plate range and set to 0 as placeholders.
      // Review whether 0 is appropriate for your model or replace with a meaningful value.
      for (let i = 1; i < ppInfo.plateStart; i++) {
        transformedParamLines.push(`  ${stanName}[${i}] = 0;  // placeholder: outside plate range`);
      }
      for (let i = ppInfo.plateStart; i <= ppInfo.fullSize; i++) {
        transformedParamLines.push(
          `  ${stanName}[${i}] = ${stanName}_free[${i - ppInfo.plateStart + 1}];`,
        );
      }
      continue;
    }

    if (partialPlateWarningNames.has(stanName)) {
      const parentPlate = node.parent ? nodeMap.get(node.parent) : undefined;
      const range = parentPlate ? convertBugsName(parentPlate.loopRange || "1:N") : "?:N";
      parameterDeclarations.push(
        `  // WARNING: '${stanName}' is in a plate with range '${range}' (lower > 1, symbolic upper).`,
      );
      parameterDeclarations.push(
        `  // Partial-plate handling requires a literal upper bound. Declare '${stanName}_free' manually.`,
      );
    }

    const dist = node.distribution;
    let baseType = "real";
    const mvDim = inferMultivariateDim(node);
    const mvDistributions = new Set(["dmnorm", "dmt", "dwish", "ddirich"]);
    const p1str = node.param1 ? String(node.param1).trim() : "";
    const mvDimExplicit = !!(p1str.match(/\[1:(\w+)\]/) || p1str.match(/\[(\d+)\]/));
    if (dist === "dmnorm" || dist === "dmt") baseType = `vector[${mvDim}]`;
    else if (dist === "dwish") baseType = `cov_matrix[${mvDim}]`;
    else if (dist === "ddirich") baseType = `simplex[${mvDim}]`;

    if (dist && mvDistributions.has(dist) && !mvDimExplicit) {
      parameterDeclarations.push(
        `  // TODO: Replace 'K' in the declaration below with the actual dimension (could not infer from param1).`,
      );
    }

    if (dist === "dwish") {
      parameterDeclarations.push(
        `  // NOTE: '${stanName}' is declared as cov_matrix (symmetric positive-definite).`,
      );
      parameterDeclarations.push(
        `  // In BUGS, dwish variables are typically used as precision matrices. If so, pass inverse(${stanName}) where a covariance matrix is expected.`,
      );
    }

    if (dist && DISCRETE_DISTRIBUTIONS.has(dist)) {
      parameterDeclarations.push(`  // WARNING: ${stanName} ~ ${dist} is a discrete distribution.`);
      parameterDeclarations.push(
        `  // Stan cannot sample discrete latent parameters. Marginalize out ${stanName} or restructure the model.`,
      );
      const reason = margReasons.get(node.id);
      if (reason) {
        parameterDeclarations.push(`  // (automatic marginalization not applied: ${reason})`);
      }
    }

    if (dims.length > 0) {
      if (
        baseType.startsWith("vector") ||
        baseType.startsWith("cov_matrix") ||
        baseType.startsWith("simplex")
      ) {
        parameterDeclarations.push(`  array[${dims.join(", ")}] ${baseType}${bounds} ${stanName};`);
      } else {
        parameterDeclarations.push(`  array[${dims.join(", ")}] real${bounds} ${stanName};`);
      }
    } else {
      parameterDeclarations.push(`  ${baseType}${bounds} ${stanName};`);
    }
  }

  const {
    transformedData,
    transformedParams: tpDetNodes,
    generatedQuantities: gqDetNodes,
  } = classifyDeterministicBlocks(
    deterministicNodes.filter((n) => !marg.inlinedDetIds.has(n.id)),
    constantNodes,
    observedNodes,
    stochasticParams,
    edges,
    nodeMap,
  );

  const transformedDataDeclLines: string[] = [];
  const transformedDataIds = new Set(transformedData.map((n) => n.id));
  const gqIds = new Set(gqDetNodes.map((n) => n.id));
  const intTransformedDataIds = new Set<string>();

  for (const node of transformedData.sort(sortByTopo)) {
    const stanName = convertBugsName(node.name);
    const dims = getArrayDimsFromNode(node, nodeMap, plates);
    const baseName = node.name.replace(/\[.*$/, "");
    const stanBaseName = convertBugsName(baseName);
    const isIndex = arrayIndexVarNames.has(baseName) || arrayIndexVarNames.has(stanBaseName);
    const baseType = isIndex ? "int" : "real";
    if (isIndex) {
      intTransformedDataIds.add(node.id);
    }
    if (dims.length > 0) {
      transformedDataDeclLines.push(`  array[${dims.join(", ")}] ${baseType} ${stanName};`);
    } else {
      transformedDataDeclLines.push(`  ${baseType} ${stanName};`);
    }
  }

  for (const node of tpDetNodes.sort(sortByTopo)) {
    const stanName = convertBugsName(node.name);
    const dims = getArrayDimsFromNode(node, nodeMap, plates);
    const needsTypeNote = nodeEquationHasMatrixResult(node, nameToNode);
    const suffix = needsTypeNote ? "  // TODO: verify type (may need vector/matrix)" : "";
    if (dims.length > 0) {
      transformedParamLines.push(`  array[${dims.join(", ")}] real ${stanName};${suffix}`);
    } else {
      transformedParamLines.push(`  real ${stanName};${suffix}`);
    }
  }

  const gqDeclLines: string[] = [];
  for (const node of gqDetNodes.sort(sortByTopo)) {
    const stanName = convertBugsName(node.name);
    const dims = getArrayDimsFromNode(node, nodeMap, plates);
    const needsTypeNote = nodeEquationHasMatrixResult(node, nameToNode);
    const suffix = needsTypeNote ? "  // TODO: verify type (may need vector/matrix)" : "";
    if (dims.length > 0) {
      gqDeclLines.push(`  array[${dims.join(", ")}] real ${stanName};${suffix}`);
    } else {
      gqDeclLines.push(`  real ${stanName};${suffix}`);
    }
  }

  const plateChildren = new Map<string, GraphNode[]>();
  const rootNodes: GraphNode[] = [];
  for (const node of nodes) {
    if (node.nodeType === "plate") continue;
    if (node.parent) {
      const list = plateChildren.get(node.parent);
      if (list) list.push(node);
      else plateChildren.set(node.parent, [node]);
    } else {
      rootNodes.push(node);
    }
  }

  const generateBlockStatements = (
    nodesToProcess: GraphNode[],
    indent: string,
    blockType: "transformed" | "model",
    detFilter?: Set<string>,
  ): string[] => {
    const lines: string[] = [];
    const sorted = [...nodesToProcess].sort(sortByTopo);

    for (const node of sorted) {
      if (blockType === "model") {
        const platePlan = platePlanByLatent.get(node.id);
        if (platePlan) {
          lines.push(...emitPlateMarginalization(platePlan, indent, nameToNode));
          continue;
        }
        if (consumedFactorIds.has(node.id) || margLatentIds.has(node.id)) continue;
      }
      if (node.nodeType === "plate") {
        const plateVar = node.loopVariable || "i";
        const plateRange = convertBugsName(node.loopRange || "1:N");
        const rangeParts = plateRange.split(":");
        const lower = rangeParts[0] || "1";
        const upper = rangeParts.length === 2 ? (rangeParts[1] as string) : plateRange;
        const children = plateChildren.get(node.id) || [];
        const nestedPlates = plates.filter((p) => p.parent === node.id);

        if (blockType === "model") {
          const canVectorize = lower === "1";
          const plateNodes = children
            .filter(
              (c) =>
                (c.nodeType === "stochastic" || c.nodeType === "observed") &&
                !consumedFactorIds.has(c.id),
            )
            .sort(sortByTopo);

          const vectorizedLines: string[] = [];
          const loopNodes: GraphNode[] = [];
          for (const child of plateNodes) {
            const vLine = canVectorize
              ? tryVectorizeNode(child, plateVar, indent, nameToNode)
              : null;
            if (vLine !== null) {
              vectorizedLines.push(vLine);
            } else {
              loopNodes.push(child);
            }
          }

          lines.push(...vectorizedLines);

          if (loopNodes.length > 0 || nestedPlates.length > 0) {
            lines.push(`${indent}for (${plateVar} in ${lower}:${upper}) {`);
            lines.push(
              ...generateBlockStatements(
                [...loopNodes, ...nestedPlates],
                `${indent}  `,
                blockType,
                detFilter,
              ),
            );
            lines.push(`${indent}}`);
          }
        } else {
          const plateNodes = children.filter(
            (c) => c.nodeType === "deterministic" && (!detFilter || detFilter.has(c.id)),
          );
          const innerLines = generateBlockStatements(
            [...plateNodes, ...nestedPlates],
            `${indent}  `,
            blockType,
            detFilter,
          );
          if (innerLines.length > 0) {
            lines.push(`${indent}for (${plateVar} in ${lower}:${upper}) {`);
            lines.push(...innerLines);
            lines.push(`${indent}}`);
          }
        }
        continue;
      }

      const stanName = convertBugsName(node.name);
      const idx = node.indices ? `[${node.indices}]` : "";

      if (blockType === "transformed" && node.nodeType === "deterministic") {
        if (detFilter && !detFilter.has(node.id)) continue;
        if (node.equation) {
          let expr = convertExpression(node.equation);
          if (intTransformedDataIds.has(node.id)) {
            expr = `to_int(round(${expr}))`;
          }
          lines.push(`${indent}${stanName}${idx} = ${expr};`);
        }
      }

      if (
        blockType === "model" &&
        (node.nodeType === "stochastic" || node.nodeType === "observed")
      ) {
        const distInfo = formatStanDistribution(node, nameToNode);
        if (distInfo === null) {
          // dflat or no distribution: no sampling statement needed
        } else if ("error" in distInfo) {
          lines.push(`${indent}// ERROR: ${distInfo.error}`);
        } else {
          const cl = node.censorLower ? String(node.censorLower).trim() : "";
          const cu = node.censorUpper ? String(node.censorUpper).trim() : "";
          const hasCensoring = !!(cl || cu);

          if (hasCensoring && node.nodeType === "observed") {
            const stanBoundL = cl ? convertExpression(convertBugsName(cl)) : "";
            const stanBoundU = cu ? convertExpression(convertBugsName(cu)) : "";
            const isObsName = `${stanName}_is_obs`;

            lines.push(`${indent}if (${isObsName}${idx} == 1) {`);
            lines.push(
              `${indent}  ${stanName}${idx} ~ ${distInfo.stanDist}(${distInfo.stanParams});`,
            );
            lines.push(`${indent}} else {`);
            if (cl && cu) {
              // Interval censoring C(L, U): L < y < U is known.
              // P(L < Y < U) = F(U) - F(L) = log_diff_exp(lcdf(U), lcdf(L))
              lines.push(
                `${indent}  target += log_diff_exp(${distInfo.stanDist}_lcdf(${stanBoundU} | ${distInfo.stanParams}), ${distInfo.stanDist}_lcdf(${stanBoundL} | ${distInfo.stanParams}));`,
              );
            } else if (cl) {
              // Lower-bound censoring C(L,): y > L is known. P(Y > L) = lccdf(L)
              lines.push(
                `${indent}  target += ${distInfo.stanDist}_lccdf(${stanBoundL} | ${distInfo.stanParams});`,
              );
            } else {
              // Upper-bound censoring C(,U): y < U is known. P(Y < U) = lcdf(U)
              lines.push(
                `${indent}  target += ${distInfo.stanDist}_lcdf(${stanBoundU} | ${distInfo.stanParams});`,
              );
            }
            lines.push(`${indent}}`);
          } else {
            if (
              node.nodeType === "stochastic" &&
              node.distribution &&
              DISCRETE_DISTRIBUTIONS.has(node.distribution)
            ) {
              lines.push(
                `${indent}// WARNING: discrete latent variable — Stan requires marginalizing out ${stanName}.`,
              );
            }
            if (node.equation && String(node.equation).trim()) {
              lines.push(
                `${indent}// WARNING: BUGS node '${stanName}' has an equation ('${convertExpression(String(node.equation).trim())}')`,
              );
              lines.push(
                `${indent}// that was not translated. Embed this expression in the distribution parameters or use a deterministic node.`,
              );
            }
            if (node.distribution === "dmulti") {
              lines.push(
                `${indent}// Note: BUGS dmulti total count N dropped — Stan's multinomial treats N = sum(y) implicitly.`,
              );
            }
            lines.push(
              `${indent}${stanName}${idx} ~ ${distInfo.stanDist}(${distInfo.stanParams});`,
            );
          }
        }
      }
    }
    return lines;
  };

  const rootDeterministic = rootNodes.filter((n) => n.nodeType === "deterministic");
  const rootStochastic = rootNodes.filter(
    (n) => n.nodeType === "stochastic" || n.nodeType === "observed",
  );
  const rootPlates = plates.filter((p) => !p.parent);

  const tdStatements = generateBlockStatements(
    [...rootDeterministic, ...rootPlates],
    "  ",
    "transformed",
    transformedDataIds,
  );

  const tpNodeIds = new Set(tpDetNodes.map((n) => n.id));
  const tpStatements = generateBlockStatements(
    [...rootDeterministic, ...rootPlates],
    "  ",
    "transformed",
    tpNodeIds,
  );

  const modelStatements = generateBlockStatements(
    [...rootStochastic, ...rootPlates],
    "  ",
    "model",
  );
  if (marg.scalarPlan) {
    modelStatements.push(...emitScalarElimination(marg.scalarPlan, nameToNode));
  }
  if (marg.issues.length > 0) {
    modelStatements.unshift(...marg.issues.map((i) => `  // NOTE: ${i}`));
  }

  const gqStatements = generateBlockStatements(
    [...rootDeterministic, ...rootPlates],
    "  ",
    "transformed",
    gqIds,
  );

  const recoveryDecls: string[] = [];
  const recoveryLines: string[] = [];
  for (const plan of marg.platePlans) {
    const { decl, lines } = emitPlateRecovery(plan, nameToNode);
    recoveryDecls.push(decl);
    recoveryLines.push(...lines);
  }
  if (marg.scalarPlan) {
    const { decls, lines } = emitScalarRecovery(marg.scalarPlan, nameToNode);
    recoveryDecls.push(...decls);
    recoveryLines.push(...lines);
  }

  const sections: string[] = [];

  if (dataDeclarations.length > 0) {
    sections.push(`data {\n${dataDeclarations.join("\n")}\n}`);
  }

  if (tdStatements.length > 0) {
    const tdDeclBlock =
      transformedDataDeclLines.length > 0 ? `${transformedDataDeclLines.join("\n")}\n` : "";
    sections.push(`transformed data {\n${tdDeclBlock}${tdStatements.join("\n")}\n}`);
  }

  if (parameterDeclarations.length > 0) {
    sections.push(`parameters {\n${parameterDeclarations.join("\n")}\n}`);
  }

  if (tpStatements.length > 0 || transformedParamLines.length > 0) {
    const tpDeclBlock =
      transformedParamLines.length > 0 ? `${transformedParamLines.join("\n")}\n` : "";
    const tpBody = tpStatements.length > 0 ? tpStatements.join("\n") : "";
    const content = tpDeclBlock + tpBody;
    if (content.trim()) {
      sections.push(`transformed parameters {\n${content}\n}`);
    }
  }

  if (modelStatements.length > 0) {
    sections.push(`model {\n${modelStatements.join("\n")}\n}`);
  }

  if (gqStatements.length > 0 || recoveryLines.length > 0) {
    const decls = [...recoveryDecls, ...gqDeclLines];
    const gqDeclBlock = decls.length > 0 ? `${decls.join("\n")}\n` : "";
    // Recovery runs first so generated quantities can read the recovered latents.
    const body = [...recoveryLines, ...gqStatements].join("\n");
    sections.push(`generated quantities {\n${gqDeclBlock}${body}\n}`);
  }

  if (sections.length === 0) {
    return "// Empty model\n";
  }

  return `${sections.join("\n\n")}\n`;
}

function replaceNullsWithZero(val: unknown): unknown {
  if (val === null || val === undefined) return 0;
  if (Array.isArray(val)) return val.map(replaceNullsWithZero);
  if (typeof val === "object") {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
      result[k] = replaceNullsWithZero(v);
    }
    return result;
  }
  return val;
}

function convertDataKeys(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(obj)) {
    result[convertBugsName(key)] = val;
  }
  return result;
}

function buildIsObsIndicator(arr: unknown): unknown {
  if (Array.isArray(arr)) {
    return arr.map((item) => {
      if (Array.isArray(item)) return buildIsObsIndicator(item);
      return item === null || item === undefined ? 0 : 1;
    });
  }
  return arr === null || arr === undefined ? 0 : 1;
}

function fillMissingWithCensor(obs: unknown, cens: unknown): unknown {
  if (Array.isArray(obs) && Array.isArray(cens)) {
    return obs.map((item, i) => fillMissingWithCensor(item, cens[i]));
  }
  if (obs === null || obs === undefined) {
    return typeof cens === "number" ? cens : 0;
  }
  return obs;
}

export interface CensoredField {
  varName: string;
  censorBoundName: string;
}

export function generateStanDataJson(
  data: Record<string, unknown>,
  censoredFields?: CensoredField[],
): string {
  const converted = convertDataKeys(data);

  if (censoredFields) {
    for (const { varName, censorBoundName } of censoredFields) {
      const stanVar = convertBugsName(varName);
      const stanBound = convertBugsName(censorBoundName);
      const obsData = converted[stanVar];
      const cenData = converted[stanBound];

      if (obsData !== undefined) {
        converted[`${stanVar}_is_obs`] = buildIsObsIndicator(obsData);
        if (cenData !== undefined) {
          converted[stanVar] = fillMissingWithCensor(obsData, cenData);
        }
      }
    }
  }

  return JSON.stringify(replaceNullsWithZero(converted), null, 2);
}

export function generateStanInitsJson(
  inits: Record<string, unknown>,
  elements?: GraphElement[],
): string {
  const converted = convertDataKeys(inits);
  if (elements) {
    const ppParams = detectPartialPlateParams(elements);
    for (const pp of ppParams) {
      if (pp.stanName in converted) {
        const arr = converted[pp.stanName];
        if (Array.isArray(arr)) {
          converted[`${pp.stanName}_free`] = arr.slice(pp.plateStart - 1);
        }
        delete converted[pp.stanName];
      }
    }
    const nodes = elements.filter((el): el is GraphNode => el.type === "node");
    const graphEdges = elements.filter((el): el is GraphEdge => el.type === "edge");
    for (const name of marginalizedLatentNames(
      elements,
      buildTopologicalOrder(nodes, graphEdges),
      ANALYZE_OPTS,
    )) {
      delete converted[convertBugsName(name)];
    }
  }
  return JSON.stringify(replaceNullsWithZero(converted), null, 2);
}

export function extractCensoredFields(elements: GraphElement[]): CensoredField[] {
  const nodes = elements.filter((el): el is GraphNode => el.type === "node");
  const result: CensoredField[] = [];
  for (const node of nodes) {
    if (node.nodeType !== "observed") continue;
    const cl = node.censorLower ? String(node.censorLower).trim() : "";
    const cu = node.censorUpper ? String(node.censorUpper).trim() : "";
    if (!cl && !cu) continue;
    // One entry per censored variable is sufficient: it drives the _is_obs indicator and
    // the fill-missing-with-bound step. The lower bound is preferred when both are set;
    // the upper bound passes through the data JSON unchanged via convertDataKeys.
    const primaryBound = cl || cu;
    result.push({ varName: node.name, censorBoundName: primaryBound.replace(/\[.*$/, "") });
  }
  return result;
}

export interface StanScriptInput {
  modelCode: string;
  data: Record<string, unknown>;
  inits: Record<string, unknown>;
  elements?: GraphElement[];
  censoredFields?: CensoredField[];
  settings: {
    n_samples: number;
    n_adapts: number;
    n_chains: number;
    seed?: number | null;
  };
}

export function generateStanStandaloneScript(input: StanScriptInput): string {
  const { modelCode, data, inits, elements, censoredFields, settings } = input;

  const dataJson = generateStanDataJson(data, censoredFields);
  const initsJson = generateStanInitsJson(inits, elements);

  const nSamples = settings?.n_samples ?? 1000;
  const nWarmup = settings?.n_adapts ?? 1000;
  const nChains = settings?.n_chains ?? 1;
  const seed = typeof settings?.seed === "number" ? settings.seed : "None";

  return renderTemplate(stanRunTemplate, {
    modelCode,
    dataJson,
    initsJson,
    nChains,
    nWarmup,
    nSamples,
    seed,
  });
}
