// From stanc3's AST to the graph document.
//
// Stan has no parser here; stanc3 does the parsing and `stanc --debug-ast` (or
// the same call in its browser build) prints the AST as an s-expression. This
// reads that text and walks it. The blocks say what a variable is: declared in
// `data` it is a constant, in `parameters` stochastic, assigned anywhere
// deterministic. A `~` whose target is data marks it observed.
//
// Stan writes vectorised statements where BUGS writes loops (`theta ~ normal(mu,
// tau)` for a `vector[J]`), so a statement on an unindexed variable with a
// declared size is drawn inside a plate over that size.

import type { GraphEdge, GraphElement, GraphNode, UnifiedModelData } from "../core/types";
import type { ParseWarning } from "./graph";

type S = string | S[];

export interface StanGraphOptions {
  name?: string;
  data?: Record<string, unknown>;
}

export interface StanGraphResult {
  model: UnifiedModelData;
  warnings: ParseWarning[];
}

// --- s-expressions ----------------------------------------------------------

export function parseSexp(text: string): S {
  let i = 0;
  const skip = () => {
    while (i < text.length && /\s/.test(text[i] ?? "")) i++;
  };
  const atom = (): string => {
    const start = i;
    if (text[i] === '"') {
      i++;
      while (i < text.length && text[i] !== '"') i += text[i] === "\\" ? 2 : 1;
      i++;
      return text.slice(start, i);
    }
    while (i < text.length && !/[\s()]/.test(text[i] ?? "")) i++;
    return text.slice(start, i);
  };
  const node = (): S => {
    skip();
    if (text[i] !== "(") return atom();
    i++;
    const items: S[] = [];
    for (;;) {
      skip();
      if (i >= text.length) throw new Error("unbalanced s-expression");
      if (text[i] === ")") {
        i++;
        return items;
      }
      items.push(node());
    }
  };
  const out = node();
  skip();
  if (i < text.length) throw new Error("trailing text after s-expression");
  return out;
}

const head = (n: S): string | undefined =>
  Array.isArray(n) && typeof n[0] === "string" ? n[0] : undefined;

/** The first list, in preorder, whose head is `name`. */
function deep(n: S, name: string): S[] | undefined {
  if (!Array.isArray(n)) return undefined;
  if (head(n) === name) return n;
  for (const c of n) {
    const f = deep(c, name);
    if (f) return f;
  }
  return undefined;
}

/** Every list, in preorder, whose head is `name`. */
function all(n: S, name: string, out: S[][] = []): S[][] {
  if (!Array.isArray(n)) return out;
  if (head(n) === name) out.push(n);
  for (const c of n) all(c, name, out);
  return out;
}

const nameOf = (n: S | undefined): string | undefined => {
  const f = n ? deep(n, "name") : undefined;
  return f && typeof f[1] === "string" ? f[1] : undefined;
};

/** `((expr X) (emeta ..))` to `X`; anything else unchanged. */
const expr = (w: S | undefined): S | undefined => {
  const f = w ? deep(w, "expr") : undefined;
  return f ? f[1] : undefined;
};

// --- printing ---------------------------------------------------------------

const BINOP: Record<string, string> = {
  Plus: "+",
  Minus: "-",
  Times: "*",
  Divide: "/",
  IntDivide: "%/%",
  Modulo: "%",
  LDivide: "\\",
  EltTimes: ".*",
  EltDivide: "./",
  Pow: "^",
  EltPow: ".^",
  Or: "||",
  And: "&&",
  Equals: "==",
  NEquals: "!=",
  Less: "<",
  Leq: "<=",
  Greater: ">",
  Geq: ">=",
};
const PREFIX: Record<string, string> = { PMinus: "-", PPlus: "+", PNot: "!" };
const POSTFIX: Record<string, string> = { Transpose: "'" };

function printIndex(idx: S): string {
  switch (head(idx)) {
    case "Single":
      return print(expr(idx));
    case "All":
      return "";
    case "Upfrom":
      return `${print(expr(idx))}:`;
    case "Downfrom":
      return `:${print(expr(idx))}`;
    case "Between": {
      const [, lo, hi] = idx as S[];
      return `${print(expr(lo))}:${print(expr(hi))}`;
    }
    case "Multiple":
      return print(expr(idx));
    default:
      return "";
  }
}

export function print(e: S | undefined): string {
  if (e === undefined) return "";
  if (typeof e === "string") return e;
  const items = e as S[];
  switch (head(e)) {
    case "Variable":
      return nameOf(e) ?? "";
    case "IntNumeral":
    case "RealNumeral":
    case "ImagNumeral":
      return String(items[1] ?? "");
    case "Indexed": {
      const [, base, idxs] = items;
      const list = Array.isArray(idxs) ? idxs : [];
      return `${print(expr(base))}[${list.map(printIndex).join(", ")}]`;
    }
    case "FunApp":
    case "CondDistApp": {
      // (FunApp kind ((name f)) (args...))
      const fn = nameOf(items[2]) ?? nameOf(e) ?? "f";
      const args = (Array.isArray(items[3]) ? items[3] : []).map((a) => print(expr(a)));
      if (head(e) === "CondDistApp" && args.length > 1)
        return `${fn}(${args[0]} | ${args.slice(1).join(", ")})`;
      return `${fn}(${args.join(", ")})`;
    }
    case "BinOp": {
      const [, l, op, r] = items;
      return `${print(expr(l))} ${BINOP[String(op)] ?? String(op)} ${print(expr(r))}`;
    }
    case "PrefixOp": {
      const [, op, a] = items;
      return `${PREFIX[String(op)] ?? String(op)}${print(expr(a))}`;
    }
    case "PostfixOp": {
      const [, a, op] = items;
      return `${print(expr(a))}${POSTFIX[String(op)] ?? String(op)}`;
    }
    case "Paren":
      return `(${print(expr(items[1]))})`;
    case "TernaryIf": {
      const [, c, a, b] = items;
      return `${print(expr(c))} ? ${print(expr(a))} : ${print(expr(b))}`;
    }
    case "ArrayExpr":
      return `{${(Array.isArray(items[1]) ? items[1] : []).map((a) => print(expr(a))).join(", ")}}`;
    case "RowVectorExpr":
      return `[${(Array.isArray(items[1]) ? items[1] : []).map((a) => print(expr(a))).join(", ")}]`;
    case "GetTarget":
      return "target()";
    case "Promotion":
      return print(expr(items[1]));
    default: {
      const inner = expr(e);
      return inner && inner !== e ? print(inner) : "";
    }
  }
}

/** Variable names an expression reads, ignoring called functions. */
function reads(e: S | undefined, out = new Set<string>()): Set<string> {
  if (!Array.isArray(e)) return out;
  if (head(e) === "Variable") {
    const n = nameOf(e);
    if (n) out.add(n);
    return out;
  }
  if (head(e) === "FunApp" || head(e) === "CondDistApp") {
    for (const a of Array.isArray(e[3]) ? e[3] : []) reads(a, out);
    return out;
  }
  for (const c of e) reads(c, out);
  return out;
}

// --- the walk ---------------------------------------------------------------

type Block =
  | "data"
  | "transformed data"
  | "parameters"
  | "transformed parameters"
  | "model"
  | "generated quantities";

const BLOCKS: Record<string, Block> = {
  datablock: "data",
  transformeddatablock: "transformed data",
  parametersblock: "parameters",
  transformedparametersblock: "transformed parameters",
  modelblock: "model",
  generatedquantitiesblock: "generated quantities",
};

interface Decl {
  name: string;
  block: Block;
  /** The declared extent along the first dimension, e.g. `J` for `vector[J]`. */
  size?: string;
}

interface Target {
  name: string;
  /** Subscript text of the target, "" when unindexed. */
  pattern: string;
  indexed: boolean;
  /** Set when the target was wrapped in a function, e.g. `to_vector(y)`. */
  through?: string;
}

interface Flat {
  kind: "stochastic" | "logical";
  target: Target;
  /** Distribution and args for `~`; the right-hand side for an assignment. */
  dist?: string;
  args: S[];
  rhs?: S;
  loopVars: Set<string>;
  plate: string | undefined;
  line: number;
}

interface Plate {
  id: string;
  variable: string;
  range: string;
  parent: string | undefined;
}

function firstSize(declType: S | undefined): string | undefined {
  if (!Array.isArray(declType)) return undefined;
  switch (head(declType)) {
    case "SVector":
    case "SRowVector":
      return print(expr(declType[2]));
    case "SMatrix":
      return print(expr(declType[2]));
    case "SArray":
      return print(expr(declType[2]));
    default:
      return undefined;
  }
}

function targetOf(e: S | undefined): Target | undefined {
  if (!Array.isArray(e)) return undefined;
  if (head(e) === "Variable") {
    const name = nameOf(e);
    return name ? { name, pattern: "", indexed: false } : undefined;
  }
  if (head(e) === "Indexed") {
    const base = expr(e[1]);
    const name = base && head(base) === "Variable" ? nameOf(base) : nameOf(e);
    const idxs = Array.isArray(e[2]) ? e[2] : [];
    return name ? { name, pattern: idxs.map(printIndex).join(", "), indexed: true } : undefined;
  }
  // `to_vector(y) ~ ...`: the statement is about y, through a reshaping function.
  if (head(e) === "FunApp") {
    const args = Array.isArray(e[3]) ? e[3] : [];
    const inner = args.length === 1 ? targetOf(expr(args[0])) : undefined;
    return inner ? { ...inner, through: nameOf(e[2]) ?? "a function" } : undefined;
  }
  return undefined;
}

// A `target +=` term that is a density call is a `~` statement in disguise.
const DENSITY_SUFFIX = /_(lpdf|lpmf|lupdf|lupmf)$/;

/** Every density call inside a `target +=` expression, as (distribution, args). */
function densityCalls(
  e: S | undefined,
  out: { dist: string; args: S[] }[] = [],
): { dist: string; args: S[] }[] {
  if (!Array.isArray(e)) return out;
  if (head(e) === "FunApp" || head(e) === "CondDistApp") {
    const fn = nameOf(e[2]) ?? "";
    if (DENSITY_SUFFIX.test(fn)) {
      out.push({ dist: fn.replace(DENSITY_SUFFIX, ""), args: Array.isArray(e[3]) ? e[3] : [] });
      return out;
    }
  }
  for (const c of e) densityCalls(c, out);
  return out;
}

function lvalueTarget(lhs: S | undefined): Target | undefined {
  if (!lhs) return undefined;
  const indexed = deep(lhs, "LIndexed");
  const variable = deep(lhs, "LVariable");
  const name = nameOf(variable ?? lhs);
  if (!name) return undefined;
  if (!indexed) return { name, pattern: "", indexed: false };
  // (LIndexed ((lval ...)) (idx ...))
  const idxs = Array.isArray(indexed[2]) ? indexed[2] : [];
  return { name, pattern: idxs.map(printIndex).join(", "), indexed: true };
}

export function graphFromStanAst(ast: string | S, options: StanGraphOptions = {}): StanGraphResult {
  const root = typeof ast === "string" ? parseSexp(ast) : ast;
  const warnings: ParseWarning[] = [];
  const decls = new Map<string, Decl>();
  const flat: Flat[] = [];
  const plates: Plate[] = [];
  const plateIds = new Map<string, number>();
  let line = 0;

  const newPlate = (variable: string, range: string, parent: string | undefined): Plate => {
    const found = plates.find(
      (p) => p.variable === variable && p.range === range && p.parent === parent,
    );
    if (found) return found;
    const n = (plateIds.get(variable) ?? 0) + 1;
    plateIds.set(variable, n);
    const p = {
      id: n === 1 ? `plate_${variable}` : `plate_${variable}_${n}`,
      variable,
      range,
      parent,
    };
    plates.push(p);
    return p;
  };

  const walk = (stmts: S[], block: Block, loopVars: Set<string>, plate: string | undefined) => {
    for (const wrapped of stmts) {
      const s = deep(wrapped, "stmt")?.[1];
      if (!Array.isArray(s)) continue;
      line++;
      switch (head(s)) {
        case "VarDecl": {
          const size = firstSize(deep(s, "decl_type")?.[1]);
          // (variables (((identifier ((name y))) (initial_value (...))) ...))
          const entries = (deep(s, "variables")?.[1] as S[] | undefined) ?? [];
          for (const entry of entries) {
            const name = nameOf(deep(entry, "identifier"));
            if (!name) continue;
            decls.set(name, { name, block, size });
            // `real s2 = sigma^2;` declares and assigns at once.
            const init = deep(entry, "initial_value")?.[1];
            const rhs = Array.isArray(init) && init.length > 0 ? expr(init) : undefined;
            if (rhs) {
              flat.push({
                kind: "logical",
                target: { name, pattern: "", indexed: false },
                args: [],
                rhs,
                loopVars,
                plate,
                line,
              });
            }
          }
          break;
        }
        case "Tilde": {
          const targetExpr = expr(deep(s, "arg"));
          const target = targetOf(targetExpr);
          const dist = nameOf(deep(s, "distribution"));
          const args = (deep(s, "args")?.[1] as S[] | undefined) ?? [];
          if (!dist) break;
          if (!target) {
            warnings.push({
              line,
              message: `${print(targetExpr)} ~ ${dist}(...) is a statement about an expression, which has no node; it is not drawn`,
            });
            break;
          }
          if (target.through) {
            warnings.push({
              line,
              message: `${target.through}(${target.name}) ~ ${dist}(...) is drawn as a statement about "${target.name}"`,
            });
          }
          const trunc = deep(s, "truncation");
          if (trunc && trunc[1] !== "NoTruncate") {
            warnings.push({
              line,
              message: `truncation on "${target.name}" has no field in the graph format and is dropped`,
            });
          }
          flat.push({ kind: "stochastic", target, dist, args, loopVars, plate, line });
          break;
        }
        case "Assignment": {
          const target = lvalueTarget(deep(s, "assign_lhs"));
          const rhs = expr(deep(s, "assign_rhs"));
          if (!target || !rhs) break;
          const op = deep(s, "assign_op")?.[1];
          if (op !== undefined && op !== "Assign") {
            warnings.push({
              line,
              message: `compound assignment to "${target.name}" is read as a plain assignment`,
            });
          }
          flat.push({ kind: "logical", target, args: [], rhs, loopVars, plate, line });
          break;
        }
        case "For": {
          const variable = nameOf(deep(s, "loop_variable")) ?? "i";
          const range = `${print(expr(deep(s, "lower_bound")))}:${print(expr(deep(s, "upper_bound")))}`;
          const p = newPlate(variable, range, plate);
          const body = deep(s, "loop_body")?.[1];
          walk(body ? [body] : [], block, new Set([...loopVars, variable]), p.id);
          break;
        }
        case "ForEach": {
          const variable = nameOf(deep(s, "loop_variable")) ?? "i";
          const over = print(expr(deep(s, "iteratee")));
          const p = newPlate(variable, `in ${over}`, plate);
          const body = deep(s, "loop_body")?.[1];
          walk(body ? [body] : [], block, new Set([...loopVars, variable]), p.id);
          break;
        }
        case "Block":
        case "Profile": {
          const inner = (Array.isArray(s[1]) ? s[1] : []) as S[];
          walk(inner, block, loopVars, plate);
          break;
        }
        case "IfThenElse":
        case "While": {
          warnings.push({
            line,
            message: `${head(s) === "While" ? "while" : "if"} in the ${block} block: its statements are drawn as if unconditional`,
          });
          for (const b of all(s, "stmt")) walk([[b]], block, loopVars, plate);
          break;
        }
        case "TargetPE":
        case "JacobianPE": {
          const what = head(s) === "TargetPE" ? "target +=" : "jacobian +=";
          const term = expr(s[1]);
          // `target += normal_lpdf(y | mu, sigma)` is `y ~ normal(mu, sigma)`.
          let drawn = 0;
          for (const { dist, args } of densityCalls(term)) {
            const [first, ...rest] = args;
            const target = targetOf(expr(first));
            if (!target) continue;
            flat.push({ kind: "stochastic", target, dist, args: rest, loopVars, plate, line });
            drawn++;
          }
          if (drawn === 0) {
            warnings.push({
              line,
              message: `${what} ${print(term).slice(0, 60)} is a factor with no node of its own; it is not drawn`,
            });
          }
          break;
        }
        default:
          break;
      }
    }
  };

  const top = Array.isArray(root) ? root : [];
  for (const b of top) {
    if (!Array.isArray(b) || typeof b[0] !== "string") continue;
    const block = BLOCKS[b[0]];
    if (!block) continue;
    const stmts = deep(b, "stmts")?.[1];
    if (Array.isArray(stmts)) walk(stmts as S[], block, new Set(), undefined);
  }

  // Vectorised statements: an unindexed target with a declared size sits in a
  // plate over that size, unless a loop over the same extent already encloses it.
  const implicitLoopVar = (size: string, taken: Set<string>): string => {
    const guess = /^[A-Za-z_]\w*$/.test(size) ? size.toLowerCase() : "i";
    let v = guess;
    for (let k = 2; taken.has(v) || v === size; k++) v = `${guess}${k}`;
    return v;
  };
  for (const f of flat) {
    if (f.target.indexed) continue;
    const size = decls.get(f.target.name)?.size;
    if (!size) continue;
    const parentPlate = f.plate ? plates.find((p) => p.id === f.plate) : undefined;
    if (parentPlate?.range.endsWith(`:${size}`)) continue;
    // An explicit `for (i in 1:N)` elsewhere is the same plate; join it rather
    // than draw a second one over the same range.
    const range = `1:${size}`;
    const existing = plates.find((p) => p.range === range && p.parent === f.plate);
    // Never a declared name: `vector[N] r` must not loop over `n` when `n` is data.
    const v =
      existing?.variable ?? implicitLoopVar(size, new Set([...f.loopVars, ...decls.keys()]));
    const p = existing ?? newPlate(v, range, f.plate);
    f.plate = p.id;
    f.target = { name: f.target.name, pattern: v, indexed: true };
    f.loopVars = new Set([...f.loopVars, v]);
  }

  // --- nodes ------------------------------------------------------------------
  const dataKeys = new Set(options.data ? Object.keys(options.data) : []);
  const isData = (name: string) => {
    const d = decls.get(name);
    return dataKeys.has(name) || d?.block === "data" || d?.block === "transformed data";
  };

  const elements: GraphElement[] = [];
  for (const p of plates) {
    const node: GraphNode = {
      id: p.id,
      name: `Plate.${p.variable}`,
      type: "node",
      nodeType: "plate",
      loopVariable: p.variable,
      loopRange: p.range,
    };
    if (p.parent) node.parent = p.parent;
    elements.push(node);
  }

  const groups = new Map<string, Flat[]>();
  const groupKey = (f: Flat) => `${f.target.name} ${f.target.pattern}`;
  for (const f of flat) {
    const k = groupKey(f);
    const g = groups.get(k);
    if (g) g.push(f);
    else groups.set(k, [f]);
  }

  const primary = new Map<string, string>();
  const nodeOf = new Map<string, string>();
  const perVar = new Map<string, number>();
  const emitted = new Set<string>();

  for (const [key, members] of groups) {
    const first = members[0];
    if (!first) continue;
    const name = first.target.name;
    const n = (perVar.get(name) ?? 0) + 1;
    perVar.set(name, n);
    const id = n === 1 ? `node_${name}` : `node_${name}_${n}`;
    if (n === 1) primary.set(name, id);
    nodeOf.set(key, id);
    emitted.add(name);

    const sto = members.find((m) => m.kind === "stochastic");
    const det = members.find((m) => m.kind === "logical");
    const node: GraphNode = { id, name, type: "node", nodeType: "deterministic" };
    if (sto) {
      node.nodeType = isData(name) || det ? "observed" : "stochastic";
      if (node.nodeType === "observed") node.observed = true;
      node.distribution = sto.dist;
      const [a, b, c] = sto.args.map((x) => print(expr(x)));
      if (a !== undefined) node.param1 = a;
      if (b !== undefined) node.param2 = b;
      if (c !== undefined) node.param3 = c;
      if (sto.args.length > 3)
        warnings.push({
          line: sto.line,
          message: `${sto.dist} has ${sto.args.length} arguments; only three are kept`,
        });
      if (det && decls.get(name)?.block === "parameters") {
        warnings.push({
          line: det.line,
          message: `parameter "${name}" is also assigned; Stan would reject this`,
        });
      }
    }
    if (det) {
      node.equation = print(det.rhs);
      if (members.filter((m) => m.kind === "logical").length > 1) {
        warnings.push({
          line: det.line,
          message: `"${name}" is assigned more than once on the same subscripts; the first is kept`,
        });
      }
    }
    if (first.plate) node.parent = first.plate;
    if (first.target.pattern) node.indices = first.target.pattern;
    elements.push(node);
  }

  // Parameters with no statement at all still exist: flat prior.
  for (const d of decls.values()) {
    if (d.block !== "parameters" || emitted.has(d.name)) continue;
    const id = `node_${d.name}`;
    primary.set(d.name, id);
    emitted.add(d.name);
    elements.push({ id, name: d.name, type: "node", nodeType: "stochastic" });
    warnings.push({
      line: 0,
      message: `parameter "${d.name}" has no ~ statement (improper flat prior)`,
    });
  }

  // Everything read but never given a statement is a constant.
  const refs = (f: Flat): Set<string> => {
    const out = new Set<string>();
    for (const a of f.args) reads(expr(a) ?? a, out);
    if (f.rhs) reads(f.rhs, out);
    for (const v of f.loopVars) out.delete(v);
    return out;
  };
  for (const f of flat) {
    for (const r of refs(f)) {
      if (emitted.has(r)) continue;
      const d = decls.get(r);
      // A bare name that is neither declared nor data is a function or a Stan built-in; skip it.
      if (!d && !dataKeys.has(r)) continue;
      emitted.add(r);
      const id = `node_${r}`;
      primary.set(r, id);
      elements.push({ id, name: r, type: "node", nodeType: "constant" });
    }
  }

  const seen = new Set<string>();
  const connect = (source: string, target: string) => {
    const id = `edge_${source}_to_${target}`;
    if (seen.has(id)) return;
    seen.add(id);
    const edge: GraphEdge = { id, type: "edge", source, target };
    elements.push(edge);
  };
  for (const f of flat) {
    const target = nodeOf.get(groupKey(f));
    if (!target) continue;
    for (const r of refs(f)) {
      const source = primary.get(r);
      if (!source) continue;
      connect(source, target);
      if (r === f.target.name && source !== target) connect(target, target);
    }
  }

  const model: UnifiedModelData = {
    name: options.name ?? "Imported Stan model",
    version: 1,
    language: "stan",
    elements,
  };
  if (options.data) model.dataContent = JSON.stringify({ data: options.data, inits: {} }, null, 2);
  return { model, warnings };
}
