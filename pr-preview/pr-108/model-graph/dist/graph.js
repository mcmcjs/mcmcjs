// ../../packages/doodleppl/src/parse/lexer.ts
var BugsSyntaxError = class extends Error {
  constructor(message, line, col) {
    super(`${message} (line ${line}, column ${col})`);
    this.line = line;
    this.col = col;
    this.name = "BugsSyntaxError";
  }
  line;
  col;
};
var OPERATORS = [
  "<-",
  "==",
  "!=",
  "<=",
  ">=",
  "&&",
  "||",
  "~",
  "<",
  ">",
  "+",
  "-",
  "*",
  "/",
  "^",
  "(",
  ")",
  "[",
  "]",
  "{",
  "}",
  ",",
  ":",
  ";",
  "=",
  "!"
];
var isIdentStart = (c) => /[A-Za-z_]/.test(c);
var isIdentPart = (c) => /[A-Za-z0-9_.]/.test(c);
var isDigit = (c) => /[0-9]/.test(c);
function tokenize(src) {
  const tokens = [];
  let i = 0;
  let line = 1;
  let lineStart = 0;
  const push = (kind, value, at3) => tokens.push({ kind, value, line, col: at3 - lineStart + 1 });
  const at2 = (k) => src[k] ?? "";
  while (i < src.length) {
    const c = at2(i);
    if (c === "\n") {
      line++;
      i++;
      lineStart = i;
      continue;
    }
    if (c === " " || c === "	" || c === "\r") {
      i++;
      continue;
    }
    if (c === "#") {
      while (i < src.length && at2(i) !== "\n") i++;
      continue;
    }
    const start = i;
    if (isDigit(c) || c === "." && isDigit(at2(i + 1))) {
      while (i < src.length && isDigit(at2(i))) i++;
      if (at2(i) === "." && isDigit(at2(i + 1))) {
        i++;
        while (i < src.length && isDigit(at2(i))) i++;
      } else if (at2(i) === "." && !isIdentPart(at2(i + 1))) {
        i++;
      }
      if ((at2(i) === "e" || at2(i) === "E") && /[-+0-9]/.test(at2(i + 1))) {
        i++;
        if (at2(i) === "+" || at2(i) === "-") i++;
        while (i < src.length && isDigit(at2(i))) i++;
      }
      push("number", src.slice(start, i), start);
      continue;
    }
    if (isIdentStart(c)) {
      while (i < src.length && isIdentPart(at2(i))) i++;
      while (at2(i - 1) === "." && i > start + 1) i--;
      push("ident", src.slice(start, i), start);
      continue;
    }
    const op = OPERATORS.find((o) => src.startsWith(o, i));
    if (op) {
      i += op.length;
      push("op", op, start);
      continue;
    }
    throw new BugsSyntaxError(`unexpected character "${c}"`, line, i - lineStart + 1);
  }
  push("eof", "", i);
  return tokens;
}

// ../../packages/doodleppl/src/parse/parser.ts
function parseProgram(source) {
  return new Parser(tokenize(source)).program();
}
var Parser = class _Parser {
  constructor(tokens) {
    this.tokens = tokens;
  }
  tokens;
  pos = 0;
  program() {
    if (this.isIdent("model")) this.pos++;
    const statements = this.peek().value === "{" ? this.block() : this.statements(() => this.peek().kind === "eof");
    if (this.peek().kind !== "eof") this.fail(`unexpected "${this.peek().value}" after the model`);
    return { statements };
  }
  block() {
    this.expectOp("{");
    const body = this.statements(() => this.peek().value === "}");
    this.expectOp("}");
    return body;
  }
  statements(done) {
    const out = [];
    while (!done()) {
      if (this.peek().kind === "eof") this.fail("unexpected end of program");
      if (this.acceptOp(";")) continue;
      out.push(this.statement());
    }
    return out;
  }
  statement() {
    const line = this.peek().line;
    if (this.isIdent("for")) return this.forLoop(line);
    const lhs = this.postfix();
    let target;
    let link;
    if (lhs.kind === "var") {
      target = { name: lhs.name, index: lhs.index };
    } else if (lhs.kind === "call" && lhs.args.length === 1 && lhs.args[0]?.kind === "var") {
      const inner = lhs.args[0];
      target = { name: inner.name, index: inner.index };
      link = lhs.fn;
    } else {
      this.fail("expected a variable on the left of ~ or <-");
    }
    if (this.acceptOp("~")) {
      if (link) this.fail("a link function cannot be used with ~");
      const dist = this.expression();
      if (dist.kind !== "call") this.fail("expected a distribution after ~");
      const bound = this.bound();
      this.acceptOp(";");
      return { kind: "stochastic", target, dist: dist.fn, args: dist.args, bound, line };
    }
    if (this.acceptOp("<-") || this.acceptOp("=")) {
      const value = this.expression();
      this.acceptOp(";");
      return { kind: "logical", target, link, value, line };
    }
    return this.fail(`expected ~ or <- after "${target.name}"`);
  }
  forLoop(line) {
    this.pos++;
    this.expectOp("(");
    const variable = this.expectIdent();
    if (!this.isIdent("in")) this.fail('expected "in" in for loop');
    this.pos++;
    const lo = this.expression();
    this.expectOp(":");
    const hi = this.expression();
    this.expectOp(")");
    const body = this.block();
    return { kind: "for", variable, lo, hi, body, line };
  }
  bound() {
    const t = this.peek();
    if (t.kind !== "ident" || !["C", "T", "I"].includes(t.value)) return void 0;
    if (this.tokens[this.pos + 1]?.value !== "(") return void 0;
    this.pos += 2;
    const lower = this.peek().value === "," ? null : this.expression();
    this.expectOp(",");
    const upper = this.peek().value === ")" ? null : this.expression();
    this.expectOp(")");
    return { form: t.value, lower, upper };
  }
  // Precedence climbing, lowest first.
  expression() {
    return this.binary(0);
  }
  static LEVELS = [
    ["||"],
    ["&&"],
    ["==", "!=", "<", ">", "<=", ">="],
    ["+", "-"],
    ["*", "/"]
  ];
  binary(level) {
    if (level >= _Parser.LEVELS.length) return this.unary();
    let left = this.binary(level + 1);
    for (; ; ) {
      const t = this.peek();
      if (t.kind !== "op" || !(_Parser.LEVELS[level] ?? []).includes(t.value)) return left;
      this.pos++;
      const right = this.binary(level + 1);
      left = { kind: "binary", op: t.value, left, right };
    }
  }
  unary() {
    const t = this.peek();
    if (t.kind === "op" && (t.value === "-" || t.value === "+" || t.value === "!")) {
      this.pos++;
      return { kind: "unary", op: t.value, arg: this.unary() };
    }
    return this.power();
  }
  power() {
    const base = this.postfix();
    if (this.acceptOp("^")) {
      return { kind: "binary", op: "^", left: base, right: this.unary() };
    }
    return base;
  }
  postfix() {
    const t = this.peek();
    if (t.kind === "number") {
      this.pos++;
      return { kind: "num", text: t.value };
    }
    if (t.kind === "op" && t.value === "(") {
      this.pos++;
      const inner = this.expression();
      this.expectOp(")");
      return { kind: "paren", inner };
    }
    if (t.kind === "ident") {
      this.pos++;
      if (this.acceptOp("(")) {
        const args = [];
        if (!this.acceptOp(")")) {
          do
            args.push(this.expression());
          while (this.acceptOp(","));
          this.expectOp(")");
        }
        return { kind: "call", fn: t.value, args };
      }
      if (this.peek().value === "[") return { kind: "var", name: t.value, index: this.index() };
      return { kind: "var", name: t.value };
    }
    return this.fail(`unexpected "${t.value || "end of program"}"`);
  }
  index() {
    this.expectOp("[");
    const items = [];
    for (; ; ) {
      const t = this.peek();
      if (t.value === "," || t.value === "]") {
        items.push(null);
      } else {
        const first = this.expression();
        if (this.acceptOp(":")) {
          const hi = this.peek().value === "," || this.peek().value === "]" ? null : this.expression();
          items.push({ kind: "range", lo: first, hi });
        } else {
          items.push(first);
        }
      }
      if (this.acceptOp("]")) return items;
      this.expectOp(",");
    }
  }
  peek() {
    return this.tokens[this.pos] ?? this.tokens[this.tokens.length - 1];
  }
  isIdent(name) {
    const t = this.peek();
    return t.kind === "ident" && t.value === name;
  }
  acceptOp(op) {
    const t = this.peek();
    if (t.kind === "op" && t.value === op) {
      this.pos++;
      return true;
    }
    return false;
  }
  expectOp(op) {
    if (!this.acceptOp(op))
      this.fail(`expected "${op}" but found "${this.peek().value || "end of program"}"`);
  }
  expectIdent() {
    const t = this.peek();
    if (t.kind !== "ident") this.fail(`expected a name but found "${t.value || "end of program"}"`);
    this.pos++;
    return t.value;
  }
  fail(message) {
    const t = this.peek();
    throw new BugsSyntaxError(message, t.line, t.col);
  }
};
var printIndex = (items) => items.map((it2) => {
  if (it2 === null) return "";
  if (it2.kind === "range")
    return `${it2.lo ? printExpr(it2.lo) : ""}:${it2.hi ? printExpr(it2.hi) : ""}`;
  return printExpr(it2);
}).join(", ");
function printExpr(e) {
  switch (e.kind) {
    case "num":
      return e.text;
    case "var":
      return e.index ? `${e.name}[${printIndex(e.index)}]` : e.name;
    case "call":
      return `${e.fn}(${e.args.map(printExpr).join(", ")})`;
    case "unary":
      return `${e.op}${printExpr(e.arg)}`;
    case "binary":
      return `${printExpr(e.left)} ${e.op} ${printExpr(e.right)}`;
    case "paren":
      return `(${printExpr(e.inner)})`;
  }
}
var printIndices = (v) => v.index ? printIndex(v.index) : "";
function referencedNames(e, skip, out = /* @__PURE__ */ new Set()) {
  if (e === null) return out;
  if ("kind" in e && e.kind === "range") {
    if (e.lo) referencedNames(e.lo, skip, out);
    if (e.hi) referencedNames(e.hi, skip, out);
    return out;
  }
  switch (e.kind) {
    case "num":
      break;
    case "var":
      if (!skip.has(e.name)) out.add(e.name);
      for (const it2 of e.index ?? []) referencedNames(it2, skip, out);
      break;
    case "call":
      for (const a of e.args) referencedNames(a, skip, out);
      break;
    case "unary":
      referencedNames(e.arg, skip, out);
      break;
    case "binary":
      referencedNames(e.left, skip, out);
      referencedNames(e.right, skip, out);
      break;
    case "paren":
      referencedNames(e.inner, skip, out);
      break;
  }
  return out;
}

// ../../packages/doodleppl/src/parse/graph.ts
var INVERSE_LINK = {
  logit: "ilogit",
  log: "exp",
  cloglog: "icloglog",
  probit: "phi"
};
function flatten(program) {
  const flat = [];
  const plates = [];
  const ids = /* @__PURE__ */ new Map();
  const walk = (stmts, loopVars, plate) => {
    for (const s of stmts) {
      if (s.kind !== "for") {
        flat.push({ stmt: s, loopVars, plate });
        continue;
      }
      const range = `${printExpr(s.lo)}:${printExpr(s.hi)}`;
      let found = plates.find(
        (p) => p.variable === s.variable && p.range === range && p.parent === plate
      );
      if (!found) {
        const n = (ids.get(s.variable) ?? 0) + 1;
        ids.set(s.variable, n);
        found = {
          id: n === 1 ? `plate_${s.variable}` : `plate_${s.variable}_${n}`,
          variable: s.variable,
          range,
          parent: plate
        };
        plates.push(found);
      }
      walk(s.body, /* @__PURE__ */ new Set([...loopVars, s.variable]), found.id);
    }
  };
  walk(program.statements, /* @__PURE__ */ new Set(), void 0);
  return { flat, plates };
}
function readRefs(f2) {
  const out = [];
  const visit = (e) => {
    if (e === null) return;
    if ("kind" in e && e.kind === "range") {
      if (e.lo) visit(e.lo);
      if (e.hi) visit(e.hi);
      return;
    }
    switch (e.kind) {
      case "var":
        if (!f2.loopVars.has(e.name)) out.push({ name: e.name, index: e.index });
        for (const it2 of e.index ?? []) visit(it2);
        break;
      case "call":
        for (const a of e.args) visit(a);
        break;
      case "unary":
        visit(e.arg);
        break;
      case "binary":
        visit(e.left);
        visit(e.right);
        break;
      case "paren":
        visit(e.inner);
        break;
      default:
        break;
    }
  };
  const s = f2.stmt;
  if (s.kind === "stochastic") {
    for (const a of s.args) visit(a);
    if (s.bound?.lower) visit(s.bound.lower);
    if (s.bound?.upper) visit(s.bound.upper);
  } else {
    visit(s.value);
  }
  return out;
}
var patternOf = (v) => printIndices(v);
function buildGraph(program, options = {}) {
  const warnings = [];
  const dataKeys = new Set(options.dataKeys ?? []);
  const { flat, plates } = flatten(program);
  const groups = /* @__PURE__ */ new Map();
  const groupKey = (f2) => `${f2.stmt.target.name}\0${patternOf(f2.stmt.target)}`;
  for (const f2 of flat) {
    const k = groupKey(f2);
    const g = groups.get(k);
    if (g) g.push(f2);
    else groups.set(k, [f2]);
  }
  const elements = [];
  for (const p of plates) {
    const node = {
      id: p.id,
      name: `Plate.${p.variable}`,
      type: "node",
      nodeType: "plate",
      loopVariable: p.variable,
      loopRange: p.range
    };
    if (p.parent) node.parent = p.parent;
    elements.push(node);
  }
  const primary = /* @__PURE__ */ new Map();
  const nodeOf = /* @__PURE__ */ new Map();
  const perVar = /* @__PURE__ */ new Map();
  const nodesOf = /* @__PURE__ */ new Map();
  for (const [key, members] of groups) {
    const first = members[0];
    if (!first) continue;
    const name = first.stmt.target.name;
    const n = (perVar.get(name) ?? 0) + 1;
    perVar.set(name, n);
    const id = n === 1 ? `node_${name}` : `node_${name}_${n}`;
    if (n === 1) primary.set(name, id);
    nodeOf.set(key, id);
    const siblings = nodesOf.get(name) ?? [];
    siblings.push({ id, pattern: patternOf(first.stmt.target) });
    nodesOf.set(name, siblings);
    const sto = members.find((m) => m.stmt.kind === "stochastic")?.stmt;
    const det = members.find((m) => m.stmt.kind === "logical")?.stmt;
    if (members.filter((m) => m.stmt.kind === "stochastic").length > 1) {
      warnings.push({
        line: first.stmt.line,
        message: `"${name}" has more than one ~ statement on the same subscripts; the first is kept`
      });
    }
    const node = { id, name, type: "node", nodeType: "deterministic" };
    if (sto && sto.kind === "stochastic") {
      node.nodeType = det || dataKeys.has(name) ? "observed" : "stochastic";
      if (node.nodeType === "observed") node.observed = true;
      node.distribution = sto.dist;
      const [a, b, c] = sto.args.map(printExpr);
      if (a !== void 0) node.param1 = a;
      if (b !== void 0) node.param2 = b;
      if (c !== void 0) node.param3 = c;
      if (sto.args.length > 3) {
        warnings.push({
          line: sto.line,
          message: `${sto.dist} has ${sto.args.length} arguments; only three are kept`
        });
      }
      if (sto.bound) {
        const { form, lower, upper } = sto.bound;
        if (form === "T") {
          warnings.push({
            line: sto.line,
            message: `truncation T(...) on "${name}" has no field in the graph format and is dropped`
          });
        } else {
          if (form === "I")
            warnings.push({
              line: sto.line,
              message: `legacy I(...) on "${name}" read as censoring C(...)`
            });
          if (lower) node.censorLower = printExpr(lower);
          if (upper) node.censorUpper = printExpr(upper);
        }
      }
    }
    if (det && det.kind === "logical") {
      const rhs = printExpr(det.value);
      if (det.link) {
        const inv = INVERSE_LINK[det.link];
        if (inv) node.equation = `${inv}(${rhs})`;
        else {
          warnings.push({
            line: det.line,
            message: `unknown link function "${det.link}" on "${name}"; kept as written`
          });
          node.equation = `${det.link}(${rhs})`;
        }
      } else {
        node.equation = rhs;
      }
      if (members.filter((m) => m.stmt.kind === "logical").length > 1) {
        warnings.push({
          line: det.line,
          message: `"${name}" is assigned more than once on the same subscripts; the first is kept`
        });
      }
    }
    const plate = first.plate;
    if (plate) node.parent = plate;
    const pattern = patternOf(first.stmt.target);
    if (pattern) node.indices = pattern;
    elements.push(node);
  }
  const plateById = new Map(plates.map((p) => [p.id, p]));
  const cover = (item, f2) => {
    if (item === null) return { kind: "any" };
    if ("kind" in item && item.kind === "range") {
      return {
        kind: "range",
        lo: item.lo ? printExpr(item.lo) : "",
        hi: item.hi ? printExpr(item.hi) : ""
      };
    }
    if (item.kind === "num") return { kind: "lit", v: Number(item.text) };
    if (item.kind === "var" && !item.index && f2.loopVars.has(item.name)) {
      for (let p = f2.plate ? plateById.get(f2.plate) : void 0; p; p = p.parent ? plateById.get(p.parent) : void 0) {
        if (p.variable === item.name) {
          const [lo = "", hi = ""] = p.range.split(":");
          return { kind: "range", lo, hi };
        }
      }
    }
    return { kind: "any" };
  };
  const numeric = (s) => /^\d+$/.test(s);
  const contained = (inner, outer) => {
    if (outer.kind === "any" || inner.kind === "any") return false;
    if (inner.kind === "lit" && outer.kind === "lit") return inner.v === outer.v;
    if (inner.kind === "lit" && outer.kind === "range") {
      return numeric(outer.lo) && inner.v >= Number(outer.lo) && (!numeric(outer.hi) || inner.v <= Number(outer.hi));
    }
    return inner.kind === "range" && outer.kind === "range" && inner.lo === outer.lo && inner.hi === outer.hi;
  };
  for (const [key, members] of groups) {
    const sto = members.find((m) => m.stmt.kind === "stochastic");
    if (!sto || dataKeys.has(sto.stmt.target.name)) continue;
    const id = nodeOf.get(key);
    const node = elements.find((e) => e.type === "node" && e.id === id);
    if (node?.nodeType !== "stochastic") continue;
    const own = sto.stmt.target.index ?? [];
    const fixedElsewhere = [...groups.values()].some(
      (others) => others.some((o) => {
        if (o.stmt.kind !== "logical" || o.stmt.target.name !== sto.stmt.target.name) return false;
        const theirs = o.stmt.target.index ?? [];
        return theirs.length === own.length && theirs.every((it2, i) => contained(cover(it2, o), cover(own[i] ?? null, sto)));
      })
    );
    if (fixedElsewhere) {
      node.nodeType = "observed";
      node.observed = true;
    }
  }
  const assigned = new Set(flat.map((f2) => f2.stmt.target.name));
  const plain = (ref, loopVars) => (ref.index ?? []).every(
    (it2) => it2 !== null && it2.kind === "var" && !it2.index && loopVars.has(it2.name)
  );
  const best = /* @__PURE__ */ new Map();
  for (const f2 of flat) {
    for (const ref of readRefs(f2)) {
      if (assigned.has(ref.name)) continue;
      const isPlain = ref.index !== void 0 && plain(ref, f2.loopVars);
      const have = best.get(ref.name);
      if (!have || isPlain && !have.plain) best.set(ref.name, { ref, f: f2, plain: isPlain });
    }
  }
  for (const [name, { ref, f: f2 }] of best) {
    const id = `node_${name}`;
    primary.set(name, id);
    const node = { id, name, type: "node", nodeType: "constant" };
    if (ref.index) {
      const used = /* @__PURE__ */ new Set();
      for (const it2 of ref.index) referencedNames(it2, /* @__PURE__ */ new Set(), used);
      node.indices = printIndices(ref);
      for (let p = f2.plate ? plateById.get(f2.plate) : void 0; p; p = p.parent ? plateById.get(p.parent) : void 0) {
        if (used.has(p.variable)) {
          node.parent = p.id;
          break;
        }
      }
    }
    elements.push(node);
  }
  const seen = /* @__PURE__ */ new Set();
  const connect = (source, target) => {
    const id = `edge_${source}_to_${target}`;
    if (seen.has(id)) return;
    seen.add(id);
    const edge = { id, type: "edge", source, target };
    elements.push(edge);
  };
  const sourcesFor = (ref) => {
    const split = nodesOf.get(ref.name);
    if (!split || split.length <= 1) {
      const one = primary.get(ref.name);
      return one ? [one] : [];
    }
    const wanted = printIndices(ref);
    const exact = split.find((n) => n.pattern === wanted);
    return exact ? [exact.id] : split.map((n) => n.id);
  };
  for (const f2 of flat) {
    const target = nodeOf.get(groupKey(f2));
    if (!target) continue;
    const done = /* @__PURE__ */ new Set();
    for (const ref of readRefs(f2)) {
      const key = `${ref.name}[${printIndices(ref)}]`;
      if (done.has(key)) continue;
      done.add(key);
      for (const source of sourcesFor(ref)) connect(source, target);
    }
  }
  const model = {
    name: options.name ?? "Imported BUGS model",
    version: 1,
    language: "bugs",
    elements
  };
  if (options.data || options.inits) {
    model.dataContent = JSON.stringify(
      { data: options.data ?? {}, inits: options.inits ?? {} },
      null,
      2
    );
  }
  return { model, warnings };
}

// ../../packages/doodleppl/src/parse/stan.ts
function parseSexp(text) {
  let i = 0;
  const skip = () => {
    while (i < text.length && /\s/.test(text[i] ?? "")) i++;
  };
  const atom = () => {
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
  const node = () => {
    skip();
    if (text[i] !== "(") return atom();
    i++;
    const items = [];
    for (; ; ) {
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
var head = (n) => Array.isArray(n) && typeof n[0] === "string" ? n[0] : void 0;
function deep(n, name) {
  if (!Array.isArray(n)) return void 0;
  if (head(n) === name) return n;
  for (const c of n) {
    const f2 = deep(c, name);
    if (f2) return f2;
  }
  return void 0;
}
function all(n, name, out = []) {
  if (!Array.isArray(n)) return out;
  if (head(n) === name) out.push(n);
  for (const c of n) all(c, name, out);
  return out;
}
var nameOf = (n) => {
  const f2 = n ? deep(n, "name") : void 0;
  return f2 && typeof f2[1] === "string" ? f2[1] : void 0;
};
var expr = (w) => {
  const f2 = w ? deep(w, "expr") : void 0;
  return f2 ? f2[1] : void 0;
};
var BINOP = {
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
  Geq: ">="
};
var PREFIX = { PMinus: "-", PPlus: "+", PNot: "!" };
var POSTFIX = { Transpose: "'" };
function printIndex2(idx) {
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
      const [, lo, hi] = idx;
      return `${print(expr(lo))}:${print(expr(hi))}`;
    }
    case "Multiple":
      return print(expr(idx));
    default:
      return "";
  }
}
function print(e) {
  if (e === void 0) return "";
  if (typeof e === "string") return e;
  const items = e;
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
      return `${print(expr(base))}[${list.map(printIndex2).join(", ")}]`;
    }
    case "FunApp":
    case "CondDistApp": {
      const fn2 = nameOf(items[2]) ?? nameOf(e) ?? "f";
      const args = (Array.isArray(items[3]) ? items[3] : []).map((a) => print(expr(a)));
      if (head(e) === "CondDistApp" && args.length > 1)
        return `${fn2}(${args[0]} | ${args.slice(1).join(", ")})`;
      return `${fn2}(${args.join(", ")})`;
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
function reads(e, out = /* @__PURE__ */ new Set()) {
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
var BLOCKS = {
  datablock: "data",
  transformeddatablock: "transformed data",
  parametersblock: "parameters",
  transformedparametersblock: "transformed parameters",
  modelblock: "model",
  generatedquantitiesblock: "generated quantities"
};
function firstSize(declType) {
  if (!Array.isArray(declType)) return void 0;
  switch (head(declType)) {
    case "SVector":
    case "SRowVector":
      return print(expr(declType[2]));
    case "SMatrix":
      return print(expr(declType[2]));
    case "SArray":
      return print(expr(declType[2]));
    default:
      return void 0;
  }
}
function targetOf(e) {
  if (!Array.isArray(e)) return void 0;
  if (head(e) === "Variable") {
    const name = nameOf(e);
    return name ? { name, pattern: "", indexed: false } : void 0;
  }
  if (head(e) === "Indexed") {
    const base = expr(e[1]);
    const name = base && head(base) === "Variable" ? nameOf(base) : nameOf(e);
    const idxs = Array.isArray(e[2]) ? e[2] : [];
    return name ? { name, pattern: idxs.map(printIndex2).join(", "), indexed: true } : void 0;
  }
  if (head(e) === "FunApp") {
    const args = Array.isArray(e[3]) ? e[3] : [];
    const inner = args.length === 1 ? targetOf(expr(args[0])) : void 0;
    return inner ? { ...inner, through: nameOf(e[2]) ?? "a function" } : void 0;
  }
  return void 0;
}
var DENSITY_SUFFIX = /_(lpdf|lpmf|lupdf|lupmf)$/;
function densityCalls(e, out = []) {
  if (!Array.isArray(e)) return out;
  if (head(e) === "FunApp" || head(e) === "CondDistApp") {
    const fn2 = nameOf(e[2]) ?? "";
    if (DENSITY_SUFFIX.test(fn2)) {
      out.push({ dist: fn2.replace(DENSITY_SUFFIX, ""), args: Array.isArray(e[3]) ? e[3] : [] });
      return out;
    }
  }
  for (const c of e) densityCalls(c, out);
  return out;
}
function lvalueTarget(lhs) {
  if (!lhs) return void 0;
  const indexed = deep(lhs, "LIndexed");
  const variable = deep(lhs, "LVariable");
  const name = nameOf(variable ?? lhs);
  if (!name) return void 0;
  if (!indexed) return { name, pattern: "", indexed: false };
  const idxs = Array.isArray(indexed[2]) ? indexed[2] : [];
  return { name, pattern: idxs.map(printIndex2).join(", "), indexed: true };
}
function graphFromStanAst(ast, options = {}) {
  const root = typeof ast === "string" ? parseSexp(ast) : ast;
  const warnings = [];
  const decls = /* @__PURE__ */ new Map();
  const flat = [];
  const plates = [];
  const plateIds = /* @__PURE__ */ new Map();
  let line = 0;
  const newPlate = (variable, range, parent) => {
    const found = plates.find(
      (p2) => p2.variable === variable && p2.range === range && p2.parent === parent
    );
    if (found) return found;
    const n = (plateIds.get(variable) ?? 0) + 1;
    plateIds.set(variable, n);
    const p = {
      id: n === 1 ? `plate_${variable}` : `plate_${variable}_${n}`,
      variable,
      range,
      parent
    };
    plates.push(p);
    return p;
  };
  const walk = (stmts, block, loopVars, plate) => {
    for (const wrapped of stmts) {
      const s = deep(wrapped, "stmt")?.[1];
      if (!Array.isArray(s)) continue;
      line++;
      switch (head(s)) {
        case "VarDecl": {
          const size = firstSize(deep(s, "decl_type")?.[1]);
          const entries = deep(s, "variables")?.[1] ?? [];
          for (const entry of entries) {
            const name = nameOf(deep(entry, "identifier"));
            if (!name) continue;
            decls.set(name, { name, block, size });
            const init = deep(entry, "initial_value")?.[1];
            const rhs = Array.isArray(init) && init.length > 0 ? expr(init) : void 0;
            if (rhs) {
              flat.push({
                kind: "logical",
                target: { name, pattern: "", indexed: false },
                args: [],
                rhs,
                loopVars,
                plate,
                line
              });
            }
          }
          break;
        }
        case "Tilde": {
          const targetExpr = expr(deep(s, "arg"));
          const target = targetOf(targetExpr);
          const dist = nameOf(deep(s, "distribution"));
          const args = deep(s, "args")?.[1] ?? [];
          if (!dist) break;
          if (!target) {
            warnings.push({
              line,
              message: `${print(targetExpr)} ~ ${dist}(...) is a statement about an expression, which has no node; it is not drawn`
            });
            break;
          }
          if (target.through) {
            warnings.push({
              line,
              message: `${target.through}(${target.name}) ~ ${dist}(...) is drawn as a statement about "${target.name}"`
            });
          }
          const trunc = deep(s, "truncation");
          if (trunc && trunc[1] !== "NoTruncate") {
            warnings.push({
              line,
              message: `truncation on "${target.name}" has no field in the graph format and is dropped`
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
          if (op !== void 0 && op !== "Assign") {
            warnings.push({
              line,
              message: `compound assignment to "${target.name}" is read as a plain assignment`
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
          walk(body ? [body] : [], block, /* @__PURE__ */ new Set([...loopVars, variable]), p.id);
          break;
        }
        case "ForEach": {
          const variable = nameOf(deep(s, "loop_variable")) ?? "i";
          const over = print(expr(deep(s, "iteratee")));
          const p = newPlate(variable, `in ${over}`, plate);
          const body = deep(s, "loop_body")?.[1];
          walk(body ? [body] : [], block, /* @__PURE__ */ new Set([...loopVars, variable]), p.id);
          break;
        }
        case "Block":
        case "Profile": {
          const inner = Array.isArray(s[1]) ? s[1] : [];
          walk(inner, block, loopVars, plate);
          break;
        }
        case "IfThenElse":
        case "While": {
          warnings.push({
            line,
            message: `${head(s) === "While" ? "while" : "if"} in the ${block} block: its statements are drawn as if unconditional`
          });
          for (const b of all(s, "stmt")) walk([[b]], block, loopVars, plate);
          break;
        }
        case "TargetPE":
        case "JacobianPE": {
          const what = head(s) === "TargetPE" ? "target +=" : "jacobian +=";
          const term = expr(s[1]);
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
              message: `${what} ${print(term).slice(0, 60)} is a factor with no node of its own; it is not drawn`
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
    if (Array.isArray(stmts)) walk(stmts, block, /* @__PURE__ */ new Set(), void 0);
  }
  const implicitLoopVar = (size, taken) => {
    const guess = /^[A-Za-z_]\w*$/.test(size) ? size.toLowerCase() : "i";
    let v = guess;
    for (let k = 2; taken.has(v) || v === size; k++) v = `${guess}${k}`;
    return v;
  };
  for (const f2 of flat) {
    if (f2.target.indexed) continue;
    const size = decls.get(f2.target.name)?.size;
    if (!size) continue;
    const parentPlate = f2.plate ? plates.find((p2) => p2.id === f2.plate) : void 0;
    if (parentPlate?.range.endsWith(`:${size}`)) continue;
    const range = `1:${size}`;
    const existing = plates.find((p2) => p2.range === range && p2.parent === f2.plate);
    const v = existing?.variable ?? implicitLoopVar(size, /* @__PURE__ */ new Set([...f2.loopVars, ...decls.keys()]));
    const p = existing ?? newPlate(v, range, f2.plate);
    f2.plate = p.id;
    f2.target = { name: f2.target.name, pattern: v, indexed: true };
    f2.loopVars = /* @__PURE__ */ new Set([...f2.loopVars, v]);
  }
  const dataKeys = new Set(options.data ? Object.keys(options.data) : []);
  const isData = (name) => {
    const d = decls.get(name);
    return dataKeys.has(name) || d?.block === "data" || d?.block === "transformed data";
  };
  const elements = [];
  for (const p of plates) {
    const node = {
      id: p.id,
      name: `Plate.${p.variable}`,
      type: "node",
      nodeType: "plate",
      loopVariable: p.variable,
      loopRange: p.range
    };
    if (p.parent) node.parent = p.parent;
    elements.push(node);
  }
  const groups = /* @__PURE__ */ new Map();
  const groupKey = (f2) => `${f2.target.name} ${f2.target.pattern}`;
  for (const f2 of flat) {
    const k = groupKey(f2);
    const g = groups.get(k);
    if (g) g.push(f2);
    else groups.set(k, [f2]);
  }
  const primary = /* @__PURE__ */ new Map();
  const nodeOf = /* @__PURE__ */ new Map();
  const perVar = /* @__PURE__ */ new Map();
  const emitted = /* @__PURE__ */ new Set();
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
    const node = { id, name, type: "node", nodeType: "deterministic" };
    if (sto) {
      node.nodeType = isData(name) || det ? "observed" : "stochastic";
      if (node.nodeType === "observed") node.observed = true;
      node.distribution = sto.dist;
      const [a, b, c] = sto.args.map((x) => print(expr(x)));
      if (a !== void 0) node.param1 = a;
      if (b !== void 0) node.param2 = b;
      if (c !== void 0) node.param3 = c;
      if (sto.args.length > 3)
        warnings.push({
          line: sto.line,
          message: `${sto.dist} has ${sto.args.length} arguments; only three are kept`
        });
      if (det && decls.get(name)?.block === "parameters") {
        warnings.push({
          line: det.line,
          message: `parameter "${name}" is also assigned; Stan would reject this`
        });
      }
    }
    if (det) {
      node.equation = print(det.rhs);
      if (members.filter((m) => m.kind === "logical").length > 1) {
        warnings.push({
          line: det.line,
          message: `"${name}" is assigned more than once on the same subscripts; the first is kept`
        });
      }
    }
    if (first.plate) node.parent = first.plate;
    if (first.target.pattern) node.indices = first.target.pattern;
    elements.push(node);
  }
  for (const d of decls.values()) {
    if (d.block !== "parameters" || emitted.has(d.name)) continue;
    const id = `node_${d.name}`;
    primary.set(d.name, id);
    emitted.add(d.name);
    elements.push({ id, name: d.name, type: "node", nodeType: "stochastic" });
    warnings.push({
      line: 0,
      message: `parameter "${d.name}" has no ~ statement (improper flat prior)`
    });
  }
  const refs = (f2) => {
    const out = /* @__PURE__ */ new Set();
    for (const a of f2.args) reads(expr(a) ?? a, out);
    if (f2.rhs) reads(f2.rhs, out);
    for (const v of f2.loopVars) out.delete(v);
    return out;
  };
  for (const f2 of flat) {
    for (const r of refs(f2)) {
      if (emitted.has(r)) continue;
      const d = decls.get(r);
      if (!d && !dataKeys.has(r)) continue;
      emitted.add(r);
      const id = `node_${r}`;
      primary.set(r, id);
      elements.push({ id, name: r, type: "node", nodeType: "constant" });
    }
  }
  const seen = /* @__PURE__ */ new Set();
  const connect = (source, target) => {
    const id = `edge_${source}_to_${target}`;
    if (seen.has(id)) return;
    seen.add(id);
    const edge = { id, type: "edge", source, target };
    elements.push(edge);
  };
  for (const f2 of flat) {
    const target = nodeOf.get(groupKey(f2));
    if (!target) continue;
    for (const r of refs(f2)) {
      const source = primary.get(r);
      if (!source) continue;
      connect(source, target);
      if (r === f2.target.name && source !== target) connect(target, target);
    }
  }
  const model = {
    name: options.name ?? "Imported Stan model",
    version: 1,
    language: "stan",
    elements
  };
  if (options.data) model.dataContent = JSON.stringify({ data: options.data, inits: {} }, null, 2);
  return { model, warnings };
}

// ../../packages/doodleppl/src/parse/index.ts
function parseBugs(source, options = {}) {
  return buildGraph(parseProgram(source), options);
}

// ../../node_modules/.pnpm/@dagrejs+dagre@3.1.1/node_modules/@dagrejs/dagre/dist/dagre.esm.js
var Te = Object.defineProperty;
var In = (e, n, t) => n in e ? Te(e, n, { enumerable: true, configurable: true, writable: true, value: t }) : e[n] = t;
var Sn = (e, n) => {
  for (var t in n) Te(e, t, { get: n[t], enumerable: true });
};
var je = (e, n, t) => In(e, typeof n != "symbol" ? n + "" : n, t);
var ie = {};
Sn(ie, { Graph: () => T, alg: () => H });
var Mn = Object.defineProperty;
var Se = (e, n) => {
  for (var t in n) Mn(e, t, { get: n[t], enumerable: true });
};
var Q = class {
  constructor(e) {
    this._isDirected = true, this._isMultigraph = false, this._isCompound = false, this._nodes = {}, this._in = {}, this._preds = {}, this._out = {}, this._sucs = {}, this._edgeObjs = {}, this._edgeLabels = {}, this._nodeCount = 0, this._edgeCount = 0, this._defaultNodeLabelFn = () => {
    }, this._defaultEdgeLabelFn = () => {
    }, e && (this._isDirected = "directed" in e ? e.directed : true, this._isMultigraph = "multigraph" in e ? e.multigraph : false, this._isCompound = "compound" in e ? e.compound : false), this._isCompound && (this._parent = {}, this._children = {}, this._children["\0"] = {});
  }
  isDirected() {
    return this._isDirected;
  }
  isMultigraph() {
    return this._isMultigraph;
  }
  isCompound() {
    return this._isCompound;
  }
  setGraph(e) {
    return this._label = e, this;
  }
  graph() {
    return this._label;
  }
  setDefaultNodeLabel(e) {
    return typeof e != "function" ? this._defaultNodeLabelFn = () => e : this._defaultNodeLabelFn = e, this;
  }
  nodeCount() {
    return this._nodeCount;
  }
  nodes() {
    return Object.keys(this._nodes);
  }
  sources() {
    return this.nodes().filter((e) => Object.keys(this._in[e]).length === 0);
  }
  sinks() {
    return this.nodes().filter((e) => Object.keys(this._out[e]).length === 0);
  }
  setNodes(e, n) {
    return e.forEach((t) => {
      n !== void 0 ? this.setNode(t, n) : this.setNode(t);
    }), this;
  }
  setNode(e, n) {
    return e in this._nodes ? (arguments.length > 1 && (this._nodes[e] = n), this) : (this._nodes[e] = arguments.length > 1 ? n : this._defaultNodeLabelFn(e), this._isCompound && (this._parent[e] = "\0", this._children[e] = {}, this._children["\0"][e] = true), this._in[e] = {}, this._preds[e] = {}, this._out[e] = {}, this._sucs[e] = {}, ++this._nodeCount, this);
  }
  node(e) {
    return this._nodes[e];
  }
  hasNode(e) {
    return e in this._nodes;
  }
  removeNode(e) {
    if (e in this._nodes) {
      let n = (t) => this.removeEdge(this._edgeObjs[t]);
      delete this._nodes[e], this._isCompound && (this._removeFromParentsChildList(e), delete this._parent[e], this.children(e).forEach((t) => {
        this.setParent(t);
      }), delete this._children[e]), Object.keys(this._in[e]).forEach(n), delete this._in[e], delete this._preds[e], Object.keys(this._out[e]).forEach(n), delete this._out[e], delete this._sucs[e], --this._nodeCount;
    }
    return this;
  }
  setParent(e, n) {
    if (!this._isCompound) throw new Error("Cannot set parent in a non-compound graph");
    if (n === void 0) n = "\0";
    else {
      n += "";
      for (let t = n; t !== void 0; t = this.parent(t)) if (t === e) throw new Error("Setting " + n + " as parent of " + e + " would create a cycle");
      this.setNode(n);
    }
    return this.setNode(e), this._removeFromParentsChildList(e), this._parent[e] = n, this._children[n][e] = true, this;
  }
  parent(e) {
    if (this._isCompound) {
      let n = this._parent[e];
      if (n !== "\0") return n;
    }
  }
  children(e = "\0") {
    if (this._isCompound) {
      let n = this._children[e];
      if (n) return Object.keys(n);
    } else {
      if (e === "\0") return this.nodes();
      if (this.hasNode(e)) return [];
    }
    return [];
  }
  predecessors(e) {
    let n = this._preds[e];
    if (n) return Object.keys(n);
  }
  successors(e) {
    let n = this._sucs[e];
    if (n) return Object.keys(n);
  }
  neighbors(e) {
    let n = this.predecessors(e);
    if (n) {
      let t = new Set(n), r = this.successors(e);
      if (r) for (let o of r) t.add(o);
      return Array.from(t.values());
    }
  }
  isLeaf(e) {
    var n;
    let t;
    return this.isDirected() ? t = this.successors(e) : t = this.neighbors(e), ((n = t == null ? void 0 : t.length) != null ? n : 0) === 0;
  }
  filterNodes(e) {
    let n = new this.constructor({ directed: this._isDirected, multigraph: this._isMultigraph, compound: this._isCompound });
    n.setGraph(this.graph()), Object.entries(this._nodes).forEach(([o, i]) => {
      e(o) && n.setNode(o, i);
    }), Object.values(this._edgeObjs).forEach((o) => {
      n.hasNode(o.v) && n.hasNode(o.w) && n.setEdge(o, this.edge(o));
    });
    let t = {}, r = (o) => {
      let i = this.parent(o);
      return !i || n.hasNode(i) ? (t[o] = i, i) : i in t ? t[i] : r(i);
    };
    return this._isCompound && n.nodes().forEach((o) => n.setParent(o, r(o))), n;
  }
  setDefaultEdgeLabel(e) {
    return typeof e != "function" ? this._defaultEdgeLabelFn = () => e : this._defaultEdgeLabelFn = e, this;
  }
  edgeCount() {
    return this._edgeCount;
  }
  edges() {
    return Object.values(this._edgeObjs);
  }
  setPath(e, n) {
    return e.reduce((t, r) => (n !== void 0 ? this.setEdge(t, r, n) : this.setEdge(t, r), r)), this;
  }
  setEdge(e, n, t, r) {
    let o, i, s, a, l = false;
    typeof e == "object" && e !== null && "v" in e ? (o = e.v, i = e.w, s = e.name, arguments.length === 2 && (a = n, l = true)) : (o = e, i = n, s = r, arguments.length > 2 && (a = t, l = true)), o = "" + o, i = "" + i, s !== void 0 && (s = "" + s);
    let u = z(this._isDirected, o, i, s);
    if (u in this._edgeLabels) return l && (this._edgeLabels[u] = a), this;
    if (s !== void 0 && !this._isMultigraph) throw new Error("Cannot set a named edge when isMultigraph = false");
    this.setNode(o), this.setNode(i), this._edgeLabels[u] = l ? a : this._defaultEdgeLabelFn(o, i, s);
    let d = Pn(this._isDirected, o, i, s);
    return o = d.v, i = d.w, Object.freeze(d), this._edgeObjs[u] = d, Re(this._preds[i], o), Re(this._sucs[o], i), this._in[i][u] = d, this._out[o][u] = d, this._edgeCount++, this;
  }
  edge(e, n, t) {
    let r = arguments.length === 1 ? oe(this._isDirected, e) : z(this._isDirected, e, n, t);
    return this._edgeLabels[r];
  }
  edgeAsObj(e, n, t) {
    let r = arguments.length === 1 ? this.edge(e) : this.edge(e, n, t);
    return typeof r != "object" || r === null ? { label: r } : r;
  }
  hasEdge(e, n, t) {
    return (arguments.length === 1 ? oe(this._isDirected, e) : z(this._isDirected, e, n, t)) in this._edgeLabels;
  }
  removeEdge(e, n, t) {
    let r = arguments.length === 1 ? oe(this._isDirected, e) : z(this._isDirected, e, n, t), o = this._edgeObjs[r];
    if (o) {
      let i = o.v, s = o.w;
      delete this._edgeLabels[r], delete this._edgeObjs[r], Ie(this._preds[s], i), Ie(this._sucs[i], s), delete this._in[s][r], delete this._out[i][r], this._edgeCount--;
    }
    return this;
  }
  inEdges(e, n) {
    return this.isDirected() ? this.filterEdges(this._in[e], e, n) : this.nodeEdges(e, n);
  }
  outEdges(e, n) {
    return this.isDirected() ? this.filterEdges(this._out[e], e, n) : this.nodeEdges(e, n);
  }
  nodeEdges(e, n) {
    if (e in this._nodes) return this.filterEdges({ ...this._in[e], ...this._out[e] }, e, n);
  }
  _removeFromParentsChildList(e) {
    delete this._children[this._parent[e]][e];
  }
  filterEdges(e, n, t) {
    if (!e) return;
    let r = Object.values(e);
    return t ? r.filter((o) => o.v === n && o.w === t || o.v === t && o.w === n) : r;
  }
};
function Re(e, n) {
  e[n] ? e[n]++ : e[n] = 1;
}
function Ie(e, n) {
  e[n] !== void 0 && !--e[n] && delete e[n];
}
function z(e, n, t, r) {
  let o = "" + n, i = "" + t;
  if (!e && o > i) {
    let s = o;
    o = i, i = s;
  }
  return o + "" + i + "" + (r === void 0 ? "\0" : r);
}
function Pn(e, n, t, r) {
  let o = "" + n, i = "" + t;
  if (!e && o > i) {
    let a = o;
    o = i, i = a;
  }
  let s = { v: o, w: i };
  return r && (s.name = r), s;
}
function oe(e, n) {
  return z(e, n.v, n.w, n.name);
}
var Fn = {};
Se(Fn, { read: () => Yn, write: () => An });
function An(e) {
  let n = { options: { directed: e.isDirected(), multigraph: e.isMultigraph(), compound: e.isCompound() }, nodes: Vn(e), edges: Dn(e) }, t = e.graph();
  return t !== void 0 && (n.value = structuredClone(t)), n;
}
function Vn(e) {
  return e.nodes().map((n) => {
    let t = e.node(n), r = e.parent(n), o = { v: n };
    return t !== void 0 && (o.value = t), r !== void 0 && (o.parent = r), o;
  });
}
function Dn(e) {
  return e.edges().map((n) => {
    let t = e.edge(n), r = { v: n.v, w: n.w };
    return n.name !== void 0 && (r.name = n.name), t !== void 0 && (r.value = t), r;
  });
}
function Yn(e) {
  let n = new Q(e.options);
  return e.value !== void 0 && n.setGraph(e.value), e.nodes.forEach((t) => {
    n.setNode(t.v, t.value), t.parent && n.setParent(t.v, t.parent);
  }), e.edges.forEach((t) => {
    n.setEdge({ v: t.v, w: t.w, name: t.name }, t.value);
  }), n;
}
var H = {};
Se(H, { CycleException: () => K, bellmanFord: () => Me, components: () => Xn, dijkstra: () => J, dijkstraAll: () => qn, findCycles: () => $n, floydWarshall: () => Jn, isAcyclic: () => Qn, postorder: () => et, preorder: () => nt, prim: () => tt, shortestPaths: () => rt, tarjan: () => Fe, topsort: () => Ae });
var Wn = () => 1;
function Me(e, n, t, r) {
  return Bn(e, String(n), t || Wn, r || function(o) {
    var i;
    return (i = e.outEdges(o)) != null ? i : [];
  });
}
function Bn(e, n, t, r) {
  let o = {}, i, s = 0, a = e.nodes(), l = function(c) {
    let f2 = o[c.v], h = o[c.w];
    if (!f2 || !h) return;
    let p = t(c);
    f2.distance + p < h.distance && (o[c.w] = { distance: f2.distance + p, predecessor: c.v }, i = true);
  }, u = function() {
    a.forEach(function(c) {
      r(c).forEach(function(f2) {
        let h = f2.v === c ? f2.v : f2.w, p = h === f2.v ? f2.w : f2.v;
        l({ v: h, w: p });
      });
    });
  };
  a.forEach(function(c) {
    let f2 = c === n ? 0 : Number.POSITIVE_INFINITY;
    o[c] = { distance: f2, predecessor: "" };
  });
  let d = a.length;
  for (let c = 1; c < d && (i = false, s++, u(), !!i); c++) ;
  if (s === d - 1 && (i = false, u(), i)) throw new Error("The graph contains a negative weight cycle");
  return o;
}
function Xn(e) {
  let n = {}, t = [], r;
  function o(i) {
    var s, a;
    i in n || (n[i] = true, r.push(i), (s = e.successors(i)) == null || s.forEach(o), (a = e.predecessors(i)) == null || a.forEach(o));
  }
  return e.nodes().forEach(function(i) {
    r = [], o(i), r.length && t.push(r);
  }), t;
}
var Pe = class {
  constructor() {
    this._arr = [], this._keyIndices = {};
  }
  size() {
    return this._arr.length;
  }
  keys() {
    return this._arr.map((e) => e.key);
  }
  has(e) {
    return e in this._keyIndices;
  }
  priority(e) {
    let n = this._keyIndices[e];
    if (n !== void 0) return this._arr[n].priority;
  }
  min() {
    if (this.size() === 0) throw new Error("Queue underflow");
    return this._arr[0].key;
  }
  add(e, n) {
    let t = this._keyIndices, r = String(e);
    if (!(r in t)) {
      let o = this._arr, i = o.length;
      return t[r] = i, o.push({ key: r, priority: n }), this._decrease(i), true;
    }
    return false;
  }
  removeMin() {
    if (this.size() === 0) throw new Error("Queue underflow");
    this._swap(0, this._arr.length - 1);
    let e = this._arr.pop();
    return delete this._keyIndices[e.key], this._heapify(0), e.key;
  }
  decrease(e, n) {
    let t = this._keyIndices[e];
    if (t === void 0) throw new Error(`Key not found: ${e}`);
    let r = this._arr[t].priority;
    if (n > r) throw new Error(`New priority is greater than current priority. Key: ${e} Old: ${r} New: ${n}`);
    this._arr[t].priority = n, this._decrease(t);
  }
  _heapify(e) {
    let n = this._arr, t = 2 * e, r = t + 1, o = e;
    t < n.length && (o = n[t].priority < n[o].priority ? t : o, r < n.length && (o = n[r].priority < n[o].priority ? r : o), o !== e && (this._swap(e, o), this._heapify(o)));
  }
  _decrease(e) {
    let n = this._arr, t = n[e].priority, r;
    for (; e !== 0 && (r = e >> 1, !(n[r].priority < t)); ) this._swap(e, r), e = r;
  }
  _swap(e, n) {
    let t = this._arr, r = this._keyIndices, o = t[e], i = t[n];
    t[e] = i, t[n] = o, r[i.key] = e, r[o.key] = n;
  }
};
var zn = () => 1;
function J(e, n, t, r) {
  let o = function(i) {
    var s;
    return (s = e.outEdges(i)) != null ? s : [];
  };
  return Hn(e, String(n), t || zn, r || o);
}
function Hn(e, n, t, r) {
  let o = {}, i = new Pe(), s, a, l = function(u) {
    let d = u.v !== s ? u.v : u.w, c = o[d];
    if (!c) return;
    let f2 = t(u), h = a.distance + f2;
    if (f2 < 0) throw new Error("dijkstra does not allow negative edge weights. Bad edge: " + u + " Weight: " + f2);
    h < c.distance && (c.distance = h, c.predecessor = s, i.decrease(d, h));
  };
  for (e.nodes().forEach(function(u) {
    let d = u === n ? 0 : Number.POSITIVE_INFINITY;
    o[u] = { distance: d, predecessor: "" }, i.add(u, d);
  }); i.size() > 0; ) {
    s = i.removeMin();
    let u = o[s];
    if (!u || u.distance === Number.POSITIVE_INFINITY) break;
    a = u, r(s).forEach(l);
  }
  return o;
}
function qn(e, n, t) {
  return e.nodes().reduce(function(r, o) {
    return r[o] = J(e, o, n, t), r;
  }, {});
}
function Fe(e) {
  let n = 0, t = [], r = {}, o = [];
  function i(s) {
    var a;
    let l = r[s] = { onStack: true, lowlink: n, index: n++ };
    if (t.push(s), (a = e.successors(s)) == null || a.forEach(function(u) {
      if (u in r) {
        let d = r[u];
        d != null && d.onStack && (l.lowlink = Math.min(l.lowlink, d.index));
      } else {
        i(u);
        let d = r[u];
        d && (l.lowlink = Math.min(l.lowlink, d.lowlink));
      }
    }), l.lowlink === l.index) {
      let u = [], d;
      do {
        d = t.pop();
        let c = r[d];
        c && (c.onStack = false), u.push(d);
      } while (s !== d);
      o.push(u);
    }
  }
  return e.nodes().forEach(function(s) {
    s in r || i(s);
  }), o;
}
function $n(e) {
  return Fe(e).filter(function(n) {
    var t;
    let r = n[0];
    return r ? n.length > 1 || n.length === 1 && ((t = e.outEdges(r, r)) != null ? t : []).length > 0 : false;
  });
}
var Un = () => 1;
function Jn(e, n, t) {
  return Kn(e, n || Un, t || function(r) {
    var o;
    return (o = e.outEdges(r)) != null ? o : [];
  });
}
function Kn(e, n, t) {
  let r = {}, o = e.nodes();
  return o.forEach(function(i) {
    let s = {};
    r[i] = s, s[i] = { distance: 0, predecessor: "" }, o.forEach(function(a) {
      i !== a && (s[a] = { distance: Number.POSITIVE_INFINITY, predecessor: "" });
    }), t(i).forEach(function(a) {
      let l = a.v === i ? a.w : a.v, u = n(a);
      s[l] = { distance: u, predecessor: i };
    });
  }), o.forEach(function(i) {
    let s = r[i];
    s && o.forEach(function(a) {
      let l = r[a];
      l && o.forEach(function(u) {
        let d = l[i], c = s[u], f2 = l[u];
        if (d && c && f2) {
          let h = d.distance + c.distance;
          h < f2.distance && (f2.distance = h, f2.predecessor = c.predecessor);
        }
      });
    });
  }), r;
}
var K = class extends Error {
  constructor(e) {
    super(e), this.name = "CycleException";
  }
};
function Ae(e) {
  let n = {}, t = {}, r = [];
  function o(i) {
    var s;
    if (i in t) throw new K();
    i in n || (t[i] = true, n[i] = true, (s = e.predecessors(i)) == null || s.forEach(o), delete t[i], r.push(i));
  }
  if (e.sinks().forEach(o), Object.keys(n).length !== e.nodeCount()) throw new K();
  return r;
}
function Qn(e) {
  try {
    Ae(e);
  } catch (n) {
    if (n instanceof K) return false;
    throw n;
  }
  return true;
}
function Zn(e, n, t, r, o) {
  Array.isArray(n) || (n = [n]);
  let i = ((a) => {
    var l;
    return (l = e.isDirected() ? e.successors(a) : e.neighbors(a)) != null ? l : [];
  }), s = {};
  return n.forEach(function(a) {
    if (!e.hasNode(a)) throw new Error("Graph does not have node: " + a);
    o = Ve(e, a, t === "post", s, i, r, o);
  }), o;
}
function Ve(e, n, t, r, o, i, s) {
  return n in r || (r[n] = true, t || (s = i(s, n)), o(n).forEach(function(a) {
    s = Ve(e, a, t, r, o, i, s);
  }), t && (s = i(s, n))), s;
}
function De(e, n, t) {
  return Zn(e, n, t, function(r, o) {
    return r.push(o), r;
  }, []);
}
function et(e, n) {
  return De(e, n, "post");
}
function nt(e, n) {
  return De(e, n, "pre");
}
function tt(e, n) {
  var t;
  let r = new Q(), o = {}, i = new Pe(), s;
  function a(d) {
    let c = d.v === s ? d.w : d.v, f2 = i.priority(c);
    if (f2 !== void 0) {
      let h = n(d);
      h < f2 && (o[c] = s, i.decrease(c, h));
    }
  }
  if (e.nodeCount() === 0) return r;
  e.nodes().forEach(function(d) {
    i.add(d, Number.POSITIVE_INFINITY), r.setNode(d);
  });
  let l = e.nodes()[0];
  l !== void 0 && i.decrease(l, 0);
  let u = false;
  for (; i.size() > 0; ) {
    if (s = i.removeMin(), s in o) r.setEdge(s, o[s]);
    else {
      if (u) throw new Error("Input graph is not connected: " + e);
      u = true;
    }
    (t = e.nodeEdges(s)) == null || t.forEach(a);
  }
  return r;
}
function rt(e, n, t, r) {
  return ot(e, n, t, r != null ? r : ((o) => {
    var i;
    return (i = e.outEdges(o)) != null ? i : [];
  }));
}
function ot(e, n, t, r) {
  if (t === void 0) return J(e, n, t, r);
  let o = false, i = e.nodes();
  for (let s = 0; s < i.length; s++) {
    let a = i[s];
    if (a === void 0) continue;
    let l = r(a);
    for (let u = 0; u < l.length; u++) {
      let d = l[u];
      if (!d) continue;
      let c = d.v === a ? d.v : d.w, f2 = c === d.v ? d.w : d.v;
      t({ v: c, w: f2 }) < 0 && (o = true);
    }
    if (o) return Me(e, n, t, r);
  }
  return J(e, n, t, r);
}
var T = Q;
function M(e, n, t, r) {
  let o = r;
  for (; e.hasNode(o); ) o = $(r);
  return t.dummy = n, e.setNode(o, t), o;
}
function Ye(e) {
  let n = new T().setGraph(e.graph());
  return e.nodes().forEach((t) => n.setNode(t, e.node(t))), e.edges().forEach((t) => {
    let r = n.edge(t.v, t.w) || { weight: 0, minlen: 1 }, o = e.edge(t);
    n.setEdge(t.v, t.w, { weight: r.weight + o.weight, minlen: Math.max(r.minlen, o.minlen) });
  }), n;
}
function Z(e) {
  let n = new T({ multigraph: e.isMultigraph() }).setGraph(e.graph());
  return e.nodes().forEach((t) => {
    e.children(t).length || n.setNode(t, e.node(t));
  }), e.edges().forEach((t) => {
    n.setEdge(t, e.edge(t));
  }), n;
}
function se(e, n) {
  let t = e.x, r = e.y, o = n.x - t, i = n.y - r, s = e.width / 2, a = e.height / 2;
  if (!o && !i) throw new Error("Not possible to find intersection inside of the rectangle");
  let l, u;
  return Math.abs(i) * s > Math.abs(o) * a ? (i < 0 && (a = -a), l = a * o / i, u = a) : (o < 0 && (s = -s), l = s, u = s * i / o), { x: t + l, y: r + u };
}
function P(e) {
  let n = A(de(e) + 1).map(() => []);
  return e.nodes().forEach((t) => {
    let r = e.node(t), o = r.rank;
    o !== void 0 && (n[o] || (n[o] = []), n[o][r.order] = t);
  }), n;
}
function We(e) {
  let n = e.nodes().map((r) => {
    let o = e.node(r).rank;
    return o === void 0 ? Number.MAX_VALUE : o;
  }), t = R(Math.min, n);
  e.nodes().forEach((r) => {
    let o = e.node(r);
    Object.hasOwn(o, "rank") && (o.rank -= t);
  });
}
function Be(e) {
  let n = e.nodes().map((s) => e.node(s).rank).filter((s) => s !== void 0), t = R(Math.min, n), r = [];
  e.nodes().forEach((s) => {
    let a = e.node(s).rank - t;
    r[a] || (r[a] = []), r[a].push(s);
  });
  let o = 0, i = e.graph().nodeRankFactor;
  Array.from(r).forEach((s, a) => {
    s === void 0 && a % i !== 0 ? --o : s !== void 0 && o && s.forEach((l) => e.node(l).rank += o);
  });
}
function ae(e, n, t, r) {
  let o = { width: 0, height: 0 };
  return arguments.length >= 4 && (o.rank = t, o.order = r), M(e, "border", o, n);
}
function it(e, n = Xe) {
  let t = [];
  for (let r = 0; r < e.length; r += n) {
    let o = e.slice(r, r + n);
    t.push(o);
  }
  return t;
}
var Xe = 65535;
function R(e, n) {
  if (n.length > Xe) {
    let t = it(n);
    return e(...t.map((r) => e(...r)));
  } else return e(...n);
}
function de(e) {
  let t = e.nodes().map((r) => {
    let o = e.node(r).rank;
    return o === void 0 ? Number.MIN_VALUE : o;
  });
  return R(Math.max, t);
}
function ze(e, n) {
  let t = { lhs: [], rhs: [] };
  return e.forEach((r) => {
    n(r) ? t.lhs.push(r) : t.rhs.push(r);
  }), t;
}
function le(e, n) {
  let t = Date.now();
  try {
    return n();
  } finally {
    console.log(e + " time: " + (Date.now() - t) + "ms");
  }
}
function q(e, n) {
  return n();
}
var st = 0;
function $(e) {
  let n = ++st;
  return e + ("" + n);
}
function A(e, n, t = 1) {
  n == null && (n = e, e = 0);
  let r = (i) => i < n;
  t < 0 && (r = (i) => n < i);
  let o = [];
  for (let i = e; r(i); i += t) o.push(i);
  return o;
}
function B(e, n) {
  let t = {};
  for (let r of n) e[r] !== void 0 && (t[r] = e[r]);
  return t;
}
function X(e, n) {
  let t;
  return typeof n == "string" ? t = (r) => r[n] : t = n, Object.entries(e).reduce((r, [o, i]) => (r[o] = t(i, o), r), {});
}
function He(e, n) {
  return e.reduce((t, r, o) => (t[r] = n[o], t), {});
}
var D = "\0";
function ee(e, n, t) {
  var u, d, c, f2, h, p;
  if (!(e && n && t && n.dummy === "edge" && t.dummy === "edge" && n.edgeObj && t.edgeObj && e[n.edgeObj.v] && e[t.edgeObj.v] && e[n.edgeObj.w] && e[t.edgeObj.w])) return 0;
  let r = true;
  n.edgeObj.w === t.edgeObj.w && (r = false);
  let o = r ? (d = (u = e[n.edgeObj.v]) == null ? void 0 : u.rank) != null ? d : NaN + 1 : (f2 = (c = e[n.edgeObj.w]) == null ? void 0 : c.rank) != null ? f2 : NaN - 1, i = Object.entries(e).find((E) => {
    var y, L;
    return ((y = E[1].edgeObj) == null ? void 0 : y.v) === n.edgeObj.v && ((L = E[1].edgeObj) == null ? void 0 : L.w) === n.edgeObj.w && E[1].rank === o;
  }), s = Object.entries(e).find((E) => {
    var y, L;
    return ((y = E[1].edgeObj) == null ? void 0 : y.v) === t.edgeObj.v && ((L = E[1].edgeObj) == null ? void 0 : L.w) === t.edgeObj.w && E[1].rank === o;
  });
  if (!i || !s) return 0;
  let a = (h = i[1].order) != null ? h : NaN, l = (p = s[1].order) != null ? p : NaN;
  return isNaN(a - l) ? 0 : a - l;
}
var ue = "3.1.1";
var ce = class {
  constructor() {
    je(this, "_sentinel");
    let n = {};
    n._next = n._prev = n, this._sentinel = n;
  }
  dequeue() {
    let n = this._sentinel, t = n._prev;
    if (t !== n) return qe(t), t;
  }
  enqueue(n) {
    let t = this._sentinel;
    n._prev && n._next && qe(n), n._next = t._next, t._next._prev = n, t._next = n, n._prev = t;
  }
  toString() {
    let n = [], t = this._sentinel, r = t._prev;
    for (; r !== t; ) n.push(JSON.stringify(r, at)), r = r._prev;
    return "[" + n.join(", ") + "]";
  }
};
function qe(e) {
  e._prev._next = e._next, e._next._prev = e._prev, delete e._next, delete e._prev;
}
function at(e, n) {
  if (e !== "_next" && e !== "_prev") return n;
}
var $e = ce;
var dt = () => 1;
function be(e, n) {
  if (e.nodeCount() <= 1) return [];
  let t = ut(e, n || dt);
  return lt(t.graph, t.buckets, t.zeroIdx).flatMap((o) => e.outEdges(o.v, o.w) || []);
}
function lt(e, n, t) {
  var a;
  let r = [], o = n[n.length - 1], i = n[0], s;
  for (; e.nodeCount(); ) {
    for (; s = i.dequeue(); ) fe(e, n, t, s);
    for (; s = o.dequeue(); ) fe(e, n, t, s);
    if (e.nodeCount()) {
      for (let l = n.length - 2; l > 0; --l) if (s = (a = n[l]) == null ? void 0 : a.dequeue(), s) {
        r = r.concat(fe(e, n, t, s, true) || []);
        break;
      }
    }
  }
  return r;
}
function fe(e, n, t, r, o) {
  let i = [], s = o ? i : void 0;
  return (e.inEdges(r.v) || []).forEach((a) => {
    let l = e.edge(a), u = e.node(a.v);
    o && i.push({ v: a.v, w: a.w }), u.out -= l, he(n, t, u);
  }), (e.outEdges(r.v) || []).forEach((a) => {
    let l = e.edge(a), u = a.w, d = e.node(u);
    d.in -= l, he(n, t, d);
  }), e.removeNode(r.v), s;
}
function ut(e, n) {
  let t = new T(), r = 0, o = 0;
  e.nodes().forEach((a) => {
    t.setNode(a, { v: a, in: 0, out: 0 });
  }), e.edges().forEach((a) => {
    let l = t.edge(a.v, a.w) || 0, u = n(a), d = l + u;
    t.setEdge(a.v, a.w, d);
    let c = t.node(a.v), f2 = t.node(a.w);
    o = Math.max(o, c.out += u), r = Math.max(r, f2.in += u);
  });
  let i = ct(o + r + 3).map(() => new $e()), s = r + 1;
  return t.nodes().forEach((a) => {
    he(i, s, t.node(a));
  }), { graph: t, buckets: i, zeroIdx: s };
}
function he(e, n, t) {
  var r, o, i;
  t.out ? t.in ? (i = e[t.out - t.in + n]) == null || i.enqueue(t) : (o = e[e.length - 1]) == null || o.enqueue(t) : (r = e[0]) == null || r.enqueue(t);
}
function ct(e) {
  let n = [];
  for (let t = 0; t < e; t++) n.push(t);
  return n;
}
function Ue(e, n) {
  (e.graph().acyclicer === "greedy" ? be(e, r(e)) : ft(e, n != null ? n : null)).forEach((o) => {
    let i = e.edge(o);
    e.removeEdge(o), i.forwardName = o.name, i.reversed = true, e.setEdge(o.w, o.v, i, $("rev"));
  });
  function r(o) {
    return (i) => o.edge(i).weight;
  }
}
function ft(e, n) {
  let t = [], r = {}, o = {};
  function i(l) {
    Object.hasOwn(o, l) || (o[l] = true, r[l] = true, e.outEdges(l).forEach((u) => {
      Object.hasOwn(r, u.w) ? t.push(u) : i(u.w);
    }), delete r[l]);
  }
  function s(l) {
    var u;
    Object.hasOwn(o, l) || (o[l] = true, r[l] = true, (u = e.outEdges(l)) == null || u.forEach((d) => {
      var c, f2;
      Object.hasOwn(r, d.w) || ((c = n.node(l)) == null ? void 0 : c.rank) > ((f2 = n.node(d.w)) == null ? void 0 : f2.rank) && ht(e, d.w, d) ? t.push(d) : s(d.w);
    }), delete r[l]);
  }
  let a = i;
  return n && typeof n.node == "function" && (a = s), e.sources().forEach(a), e.nodes().forEach(a), t;
}
function Je(e) {
  e.edges().forEach((n) => {
    let t = e.edge(n);
    if (t.reversed) {
      e.removeEdge(n);
      let r = t.forwardName;
      delete t.reversed, delete t.forwardName, e.setEdge(n.w, n.v, t, r);
    }
  });
}
function ht(e, n, t) {
  let r = /* @__PURE__ */ new Set();
  function o(i) {
    var s;
    if (e.sources().includes(i)) return true;
    r.add(i);
    for (let a of (s = e.inEdges(i)) != null ? s : []) if (!(a.v === t.v && a.w === t.w) && !r.has(a.v) && o(a.v)) return true;
    return false;
  }
  return o(n);
}
function Ke(e) {
  e.graph().dummyChains = [], e.edges().forEach((n) => gt(e, n));
}
function gt(e, n) {
  let t = n.v, r = e.node(t).rank, o = n.w, i = e.node(o).rank, s = n.name, a = e.edge(n), l = a.labelRank;
  if (i === r + 1) return;
  e.removeEdge(n);
  let u, d, c;
  for (c = 0, ++r; r < i; ++c, ++r) a.points = [], d = { width: 0, height: 0, edgeLabel: a, edgeObj: n, rank: r }, u = M(e, "edge", d, "_d"), r === l && (d.width = a.width, d.height = a.height, d.dummy = "edge-label", d.labelpos = a.labelpos), e.setEdge(t, u, { weight: a.weight }, s), c === 0 && e.graph().dummyChains.push(u), t = u;
  e.setEdge(t, o, { weight: a.weight }, s);
}
function Qe(e) {
  e.graph().dummyChains.forEach((n) => {
    let t = e.node(n), r = t.edgeLabel, o;
    for (e.setEdge(t.edgeObj, r); t.dummy; ) o = e.successors(n)[0], e.removeNode(n), r.points.push({ x: t.x, y: t.y }), t.dummy === "edge-label" && (r.x = t.x, r.y = t.y, r.width = t.width, r.height = t.height), n = o, t = e.node(n);
  });
}
function U(e) {
  let n = {};
  function t(r) {
    let o = e.node(r);
    if (Object.hasOwn(n, r)) return o.rank;
    n[r] = true;
    let i = e.outEdges(r), s = i ? i.map((l) => l == null ? Number.POSITIVE_INFINITY : t(l.w) - e.edge(l).minlen) : [], a = R(Math.min, s);
    return a === Number.POSITIVE_INFINITY && (a = 0), o.rank = a;
  }
  e.sources().forEach(t);
}
function V(e, n) {
  return e.node(n.w).rank - e.node(n.v).rank - e.edge(n).minlen;
}
var ne = mt;
function mt(e) {
  let n = new T({ directed: false }), t = e.nodes();
  if (t.length === 0) throw new Error("Graph must have at least one node");
  let r = t[0], o = e.nodeCount();
  n.setNode(r, {});
  let i, s;
  for (; Et(n, e) < o && (i = Lt(n, e), !!i); ) s = n.hasNode(i.v) ? V(e, i) : -V(e, i), yt(n, e, s);
  return n;
}
function Et(e, n) {
  function t(r) {
    let o = n.nodeEdges(r);
    o && o.forEach((i) => {
      let s = i.v, a = r === s ? i.w : s;
      !e.hasNode(a) && !V(n, i) && (e.setNode(a, {}), e.setEdge(r, a, {}), t(a));
    });
  }
  return e.nodes().forEach(t), e.nodeCount();
}
function Lt(e, n) {
  return n.edges().reduce((r, o) => {
    let i = Number.POSITIVE_INFINITY;
    return e.hasNode(o.v) !== e.hasNode(o.w) && (i = V(n, o)), i < r[0] ? [i, o] : r;
  }, [Number.POSITIVE_INFINITY, null])[1];
}
function yt(e, n, t) {
  e.nodes().forEach((r) => n.node(r).rank += t);
}
var { preorder: wt, postorder: Nt } = H;
var en = Y;
Y.initLowLimValues = pe;
Y.initCutValues = ge;
Y.calcCutValue = nn;
Y.leaveEdge = rn;
Y.enterEdge = on;
Y.exchangeEdges = sn;
function Y(e) {
  e = Ye(e), U(e);
  let n = ne(e);
  pe(n), ge(n, e);
  let t, r;
  for (; t = rn(n); ) r = on(n, e, t), sn(n, e, t, r);
}
function ge(e, n) {
  let t = Nt(e, e.nodes());
  t = t.slice(0, t.length - 1), t.forEach((r) => Gt(e, n, r));
}
function Gt(e, n, t) {
  let o = e.node(t).parent, i = e.edge(t, o);
  i.cutvalue = nn(e, n, t);
}
function nn(e, n, t) {
  let o = e.node(t).parent, i = true, s = n.edge(t, o), a = 0;
  s || (i = false, s = n.edge(o, t)), a = s.weight;
  let l = n.nodeEdges(t);
  return l && l.forEach((u) => {
    let d = u.v === t, c = d ? u.w : u.v;
    if (c !== o) {
      let f2 = d === i, h = n.edge(u).weight;
      if (a += f2 ? h : -h, kt(e, t, c)) {
        let E = e.edge(t, c).cutvalue;
        a += f2 ? -E : E;
      }
    }
  }), a;
}
function pe(e, n) {
  arguments.length < 2 && (n = e.nodes()[0]), tn(e, {}, 1, n);
}
function tn(e, n, t, r, o) {
  let i = t, s = e.node(r);
  n[r] = true;
  let a = e.neighbors(r);
  return a && a.forEach((l) => {
    Object.hasOwn(n, l) || (t = tn(e, n, t, l, r));
  }), s.low = i, s.lim = t++, o ? s.parent = o : delete s.parent, t;
}
function rn(e) {
  return e.edges().find((n) => e.edge(n).cutvalue < 0);
}
function on(e, n, t) {
  let r = t.v, o = t.w;
  n.hasEdge(r, o) || (r = t.w, o = t.v);
  let i = e.node(r), s = e.node(o), a = i, l = false;
  return i.lim > s.lim && (a = s, l = true), n.edges().filter((d) => l === Ze(e, e.node(d.v), a) && l !== Ze(e, e.node(d.w), a)).reduce((d, c) => V(n, c) < V(n, d) ? c : d);
}
function sn(e, n, t, r) {
  let o = t.v, i = t.w;
  e.removeEdge(o, i), e.setEdge(r.v, r.w, {}), pe(e), ge(e, n), vt(e, n);
}
function vt(e, n) {
  let t = e.nodes().find((o) => !e.node(o).parent);
  if (!t) return;
  let r = wt(e, [t]);
  r = r.slice(1), r.forEach((o) => {
    let s = e.node(o).parent, a = n.edge(o, s), l = false;
    a || (a = n.edge(s, o), l = true), n.node(o).rank = n.node(s).rank + (l ? a.minlen : -a.minlen);
  });
}
function kt(e, n, t) {
  return e.hasEdge(n, t);
}
function Ze(e, n, t) {
  return t.low <= n.lim && n.lim <= t.lim;
}
var dn = xt;
function xt(e) {
  let n = e.graph().ranker;
  if (typeof n == "function") return n(e);
  switch (n) {
    case "network-simplex":
      an(e);
      break;
    case "tight-tree":
      Ot(e);
      break;
    case "longest-path":
      _t(e);
      break;
    case "none":
      break;
    default:
      an(e);
  }
}
var _t = U;
function Ot(e) {
  U(e), ne(e);
}
function an(e) {
  en(e);
}
var ln = Ct;
function Ct(e) {
  let n = jt(e), t = e.graph();
  if (!Array.isArray(t.dummyChains)) return;
  t.dummyChains.forEach((o) => {
    let i = e.node(o), s = i.edgeObj, a = Tt(e, n, s.v, s.w), l = a.path, u = a.lca, d = 0, c = l[d], f2 = true;
    for (; o !== s.w; ) {
      if (i = e.node(o), f2) {
        for (; (c = l[d]) !== u && e.node(c).maxRank < i.rank; ) d++;
        c === u && (f2 = false);
      }
      if (!f2) {
        for (; d < l.length - 1 && e.node(l[d + 1]).minRank <= i.rank; ) d++;
        c = l[d];
      }
      c !== void 0 && e.setParent(o, c), o = e.successors(o)[0];
    }
  });
}
function Tt(e, n, t, r) {
  let o = [], i = [], s = Math.min(n[t].low, n[r].low), a = Math.max(n[t].lim, n[r].lim), l;
  l = t;
  do
    l = e.parent(l), o.push(l);
  while (l && (n[l].low > s || a > n[l].lim));
  let u = l, d = r;
  for (; (d = e.parent(d)) !== u; ) i.push(d);
  return { path: o.concat(i.reverse()), lca: u };
}
function jt(e) {
  let n = {}, t = 0;
  function r(o) {
    let i = t;
    e.children(o).forEach(r), n[o] = { low: i, lim: t++ };
  }
  return e.children(D).forEach(r), n;
}
function un(e) {
  let n = M(e, "root", {}, "_root"), t = Rt(e), r = Object.values(t), o = R(Math.max, r) - 1, i = 2 * o + 1;
  e.graph().nestingRoot = n, e.edges().forEach((a) => e.edge(a).minlen *= i);
  let s = It(e) + 1;
  e.children(D).forEach((a) => {
    cn(e, n, i, s, o, t, a);
  }), e.graph().nodeRankFactor = i;
}
function cn(e, n, t, r, o, i, s) {
  var c;
  let a = e.children(s);
  if (!a.length) {
    s !== n && e.setEdge(n, s, { weight: 0, minlen: t });
    return;
  }
  let l = ae(e, "_bt"), u = ae(e, "_bb"), d = e.node(s);
  e.setParent(l, s), d.borderTop = l, e.setParent(u, s), d.borderBottom = u, a.forEach((f2) => {
    var b;
    cn(e, n, t, r, o, i, f2);
    let h = e.node(f2), p = h.borderTop ? h.borderTop : f2, E = h.borderBottom ? h.borderBottom : f2, y = h.borderTop ? r : 2 * r, L = p !== E ? 1 : o - ((b = i[s]) != null ? b : 0) + 1;
    e.setEdge(l, p, { weight: y, minlen: L, nestingEdge: true }), e.setEdge(E, u, { weight: y, minlen: L, nestingEdge: true });
  }), e.parent(s) || e.setEdge(n, l, { weight: 0, minlen: o + ((c = i[s]) != null ? c : 0) });
}
function Rt(e) {
  let n = {};
  function t(r, o) {
    let i = e.children(r);
    i && i.length && i.forEach((s) => t(s, o + 1)), n[r] = o;
  }
  return e.children(D).forEach((r) => t(r, 1)), n;
}
function It(e) {
  return e.edges().reduce((n, t) => n + e.edge(t).weight, 0);
}
function fn(e) {
  let n = e.graph();
  e.removeNode(n.nestingRoot), delete n.nestingRoot, e.edges().forEach((t) => {
    e.edge(t).nestingEdge && e.removeEdge(t);
  });
}
var bn = Mt;
function Mt(e) {
  function n(t) {
    let r = e.children(t), o = e.node(t);
    if (r.length && r.forEach(n), o && Object.hasOwn(o, "minRank")) {
      o.borderLeft = [], o.borderRight = [];
      for (let i = o.minRank, s = o.maxRank + 1; i < s; ++i) hn(e, "borderLeft", "_bl", t, o, i), hn(e, "borderRight", "_br", t, o, i);
    }
  }
  e.children(D).forEach(n);
}
function hn(e, n, t, r, o, i) {
  let s = { width: 0, height: 0, rank: i, borderType: n }, a = o[n][i - 1], l = M(e, "border", s, t);
  o[n][i] = l, e.setParent(l, r), a && e.setEdge(a, l, { weight: 1 });
}
function pn(e) {
  var t;
  let n = (t = e.graph().rankdir) == null ? void 0 : t.toLowerCase();
  (n === "lr" || n === "rl") && En(e);
}
function mn(e) {
  var t;
  let n = (t = e.graph().rankdir) == null ? void 0 : t.toLowerCase();
  (n === "bt" || n === "rl") && Pt(e), (n === "lr" || n === "rl") && (Ft(e), En(e));
}
function En(e) {
  e.nodes().forEach((n) => gn(e.node(n))), e.edges().forEach((n) => gn(e.edge(n)));
}
function gn(e) {
  let n = e.width;
  e.width = e.height, e.height = n;
}
function Pt(e) {
  e.nodes().forEach((n) => me(e.node(n))), e.edges().forEach((n) => {
    var r;
    let t = e.edge(n);
    (r = t.points) == null || r.forEach(me), Object.hasOwn(t, "y") && me(t);
  });
}
function me(e) {
  e.y = -e.y;
}
function Ft(e) {
  e.nodes().forEach((n) => Ee(e.node(n))), e.edges().forEach((n) => {
    var r;
    let t = e.edge(n);
    (r = t.points) == null || r.forEach(Ee), Object.hasOwn(t, "x") && Ee(t);
  });
}
function Ee(e) {
  let n = e.x;
  e.x = e.y, e.y = n;
}
function Le(e, n = null) {
  let t = {}, r = e.nodes().filter((d) => !e.children(d).length), o = r.map((d) => e.node(d).rank), i = R(Math.max, o), s = A(i + 1).map(() => []);
  function a(d) {
    if (t[d]) return;
    t[d] = true;
    let c = e.node(d);
    s[c.rank].push(d);
    let f2 = e.successors(d);
    f2 && [...f2].sort((p, E) => u(p, E)).forEach(a);
  }
  r.sort((d, c) => e.node(d).rank - e.node(c).rank).forEach(a);
  function u(d, c) {
    let f2 = e.node(d), h = e.node(c);
    return ee(n, f2, h);
  }
  return s;
}
function ye(e, n) {
  let t = 0;
  for (let r = 1; r < n.length; ++r) t += Vt(e, n[r - 1], n[r]);
  return t;
}
function Vt(e, n, t) {
  let r = He(t, t.map((u, d) => d)), o = n.flatMap((u) => {
    let d = e.outEdges(u);
    return d ? d.map((c) => ({ pos: r[c.w], weight: e.edge(c).weight })).sort((c, f2) => c.pos - f2.pos) : [];
  }), i = 1;
  for (; i < t.length; ) i <<= 1;
  let s = 2 * i - 1;
  i -= 1;
  let a = new Array(s).fill(0), l = 0;
  return o.forEach((u) => {
    let d = u.pos + i;
    a[d] += u.weight;
    let c = 0;
    for (; d > 0; ) d % 2 && (c += a[d + 1]), d = d - 1 >> 1, a[d] += u.weight;
    l += u.weight * c;
  }), l;
}
function we(e, n = []) {
  return n.map((t) => {
    let r = e.inEdges(t);
    if (!r || !r.length) return { v: t };
    {
      let o = r.reduce((i, s) => {
        let a = e.edge(s), l = e.node(s.v);
        return { sum: i.sum + a.weight * l.order, weight: i.weight + a.weight };
      }, { sum: 0, weight: 0 });
      return { v: t, barycenter: o.sum / o.weight, weight: o.weight };
    }
  });
}
function Ne(e, n) {
  let t = {};
  e.forEach((o, i) => {
    let s = { indegree: 0, in: [], out: [], vs: [o.v], i };
    o.barycenter !== void 0 && (s.barycenter = o.barycenter, s.weight = o.weight), t[o.v] = s;
  }), n.edges().forEach((o) => {
    let i = t[o.v], s = t[o.w];
    i !== void 0 && s !== void 0 && (s.indegree++, i.out.push(s));
  });
  let r = Object.values(t).filter((o) => !o.indegree);
  return Dt(r);
}
function Dt(e) {
  let n = [];
  function t(o) {
    return (i) => {
      i.merged || (i.barycenter === void 0 || o.barycenter === void 0 || i.barycenter >= o.barycenter) && Yt(o, i);
    };
  }
  function r(o) {
    return (i) => {
      i.in.push(o), --i.indegree === 0 && e.push(i);
    };
  }
  for (; e.length; ) {
    let o = e.pop();
    n.push(o), o.in.reverse().forEach(t(o)), o.out.forEach(r(o));
  }
  return n.filter((o) => !o.merged).map((o) => B(o, ["vs", "i", "barycenter", "weight"]));
}
function Yt(e, n) {
  let t = 0, r = 0;
  e.weight && (t += e.barycenter * e.weight, r += e.weight), n.weight && (t += n.barycenter * n.weight, r += n.weight), e.vs = n.vs.concat(e.vs), e.barycenter = t / r, e.weight = r, e.i = Math.min(n.i, e.i), n.merged = true;
}
function Ge(e, n, t, r, o) {
  let i = {}, s = null, a = null, l = o;
  typeof n == "boolean" ? (l = n, i = {}) : n && (i = n, s = t != null ? t : null, a = r != null ? r : null);
  let u = ze(e, (L) => Object.hasOwn(L, "barycenter")), d = u.lhs, c = u.rhs.sort((L, b) => b.i - L.i), f2 = [], h = 0, p = 0, E = 0;
  d.sort(Wt(a, s, !!l));
  for (let [L, b] of Object.entries(i)) {
    let g = d.findIndex((m) => m.vs[0] === L);
    d.splice(g + 1, 0, b);
  }
  E = Ln(f2, c, E), d.forEach((L) => {
    E += L.vs.length, f2.push(L.vs), h += L.barycenter * L.weight, p += L.weight, E = Ln(f2, c, E);
  });
  let y = { vs: f2.flat(1) };
  return p && (y.barycenter = h / p, y.weight = p), y;
}
function Ln(e, n, t) {
  let r;
  for (; n.length && (r = n[n.length - 1]).i <= t; ) n.pop(), e.push(r.vs), t++;
  return t;
}
function Wt(e, n, t) {
  return (r, o) => {
    if (r.barycenter < o.barycenter) return -1;
    if (r.barycenter > o.barycenter) return 1;
    if (e && (typeof r.vs[0] == "string" || typeof o.vs[0] == "string")) {
      let i = e.node(r.vs[0]), s = e.node(o.vs[0]), a = ee(n, i, s);
      if (a !== 0) return a;
    }
    return t ? o.i - r.i : r.i - o.i;
  };
}
function te(e, n, t, r, o) {
  var L, b, g, m, w, k, _, C, j, I, S;
  let i = null, s = o;
  typeof r == "boolean" ? (s = r, i = null) : r !== void 0 && (i = r);
  let a = e.children(n), l = e.node(n), u = l ? l.borderLeft : void 0, d = l ? l.borderRight : void 0, c = {};
  u && (a = a.filter((G) => G !== u && G !== d));
  let f2 = we(e, a);
  f2.forEach((G) => {
    if (e.children(G.v).length) {
      let { result: x } = te(e, G.v, t, i, s);
      c[G.v] = x, Object.hasOwn(x, "barycenter") && Xt(G, x);
    }
  });
  let h = Ne(f2, t);
  Bt(h, c);
  let p = {}, E = false;
  for (let G = 0; G < h.length; G++) for (let x = G + 1; x < h.length; x++) if (!(!h[G] || !h[x] || !((L = h[G]) != null && L.barycenter) || !((b = h[x]) != null && b.barycenter)) && ((g = h[G]) == null ? void 0 : g.barycenter) === h[x].barycenter) {
    let v = (w = (m = h[G]) == null ? void 0 : m.vs[0]) != null ? w : "", N = (_ = (k = h[x]) == null ? void 0 : k.vs[0]) != null ? _ : "", O = e.node(v), W = e.node(N);
    if (O.dummy === "edge" && W.dummy === "edge" && ((C = O.edgeObj) == null ? void 0 : C.v) === ((j = W.edgeObj) == null ? void 0 : j.v) && ((I = O.edgeObj) == null ? void 0 : I.w) === ((S = W.edgeObj) == null ? void 0 : S.w)) if (O.edgeLabel.reversed) {
      p[N] = h[G], h.splice(G, 1), G--;
      break;
    } else p[v] = h[x], h.splice(x, 1), x--;
    else E = true;
  }
  let y = Ge(h, p, i, e, s);
  if (u && d) {
    y.vs = [u, y.vs, d].flat(1);
    let G = e.predecessors(u);
    if (G && G.length) {
      let x = e.node(G[0]), v = e.predecessors(d), N = e.node(v[0]);
      Object.hasOwn(y, "barycenter") || (y.barycenter = 0, y.weight = 0), y.barycenter = (y.barycenter * y.weight + x.order + N.order) / (y.weight + 2), y.weight += 2;
    }
  }
  return Object.defineProperty(y, "result", { value: y, enumerable: false, configurable: true, writable: true }), Object.defineProperty(y, "usedBias", { value: E, enumerable: false, configurable: true, writable: true }), y;
}
function Bt(e, n) {
  e.forEach((t) => {
    t.vs = t.vs.flatMap((r) => n[r] ? n[r].vs : r);
  });
}
function Xt(e, n) {
  e.barycenter !== void 0 ? (e.barycenter = (e.barycenter * e.weight + n.barycenter * n.weight) / (e.weight + n.weight), e.weight += n.weight) : (e.barycenter = n.barycenter, e.weight = n.weight);
}
function ve(e, n, t, r) {
  r || (r = e.nodes());
  let o = zt(e), i = new T({ compound: true }).setGraph({ root: o }).setDefaultNodeLabel((s) => e.node(s));
  return r.forEach((s) => {
    let a = e.node(s), l = e.parent(s);
    if (a.rank === n || a.minRank <= n && n <= a.maxRank) {
      i.setNode(s), i.setParent(s, l || o);
      let u = e[t](s);
      u && u.forEach((d) => {
        let c = d.v === s ? d.w : d.v, f2 = i.edge(c, s), h = f2 !== void 0 ? f2.weight : 0;
        i.setEdge(c, s, { weight: e.edge(d).weight + h });
      }), Object.hasOwn(a, "minRank") && i.setNode(s, { borderLeft: a.borderLeft[n], borderRight: a.borderRight[n] });
    }
  }), i;
}
function zt(e) {
  let n;
  for (; e.hasNode(n = $("_root")); ) ;
  return n;
}
function ke(e, n, t) {
  let r = {}, o;
  t.forEach((i) => {
    let s = e.parent(i), a, l;
    for (; s; ) {
      if (a = e.parent(s), a ? (l = r[a], r[a] = s) : (l = o, o = s), l && l !== s) {
        n.setEdge(l, s);
        return;
      }
      s = a;
    }
  });
}
function re(e, n = {}, t = null) {
  if (typeof n.customOrder == "function") {
    n.customOrder(e, re);
    return;
  }
  let r = de(e), o = yn(e, A(1, r + 1), "inEdges"), i = yn(e, A(r - 1, -1, -1), "outEdges"), s = Le(e, t);
  if (wn(e, s), n.disableOptimalOrderHeuristic) return;
  let a = Number.POSITIVE_INFINITY, l, u = n.constraints || [];
  for (let d = 0, c = 0; c < 4; ++d, ++c) {
    Ht(d % 2 ? o : i, d % 4 >= 2, u, t), s = P(e);
    let f2 = ye(e, s);
    f2 < a ? (c = 0, l = Object.assign({}, s), a = f2) : f2 === a && (l = structuredClone(s));
  }
  wn(e, l);
}
function yn(e, n, t) {
  let r = /* @__PURE__ */ new Map(), o = (i, s) => {
    r.has(i) || r.set(i, []), r.get(i).push(s);
  };
  for (let i of e.nodes()) {
    let s = e.node(i);
    if (typeof s.rank == "number" && o(s.rank, i), typeof s.minRank == "number" && typeof s.maxRank == "number") for (let a = s.minRank; a <= s.maxRank; a++) a !== s.rank && o(a, i);
  }
  return n.map(function(i) {
    return ve(e, i, t, r.get(i) || []);
  });
}
function Ht(e, n, t, r) {
  let o = true, i = new T();
  e.forEach(function(s) {
    t.forEach((d) => i.setEdge(d.left, d.right));
    let a = s.graph().root, { result: l, usedBias: u } = te(s, a, i, r, o);
    n && u && (o = !o), l.vs.forEach((d, c) => s.node(d).order = c), ke(s, i, l.vs);
  });
}
function wn(e, n) {
  Object.values(n).forEach((t) => t.forEach((r, o) => e.node(r).order = o));
}
function qt(e, n) {
  let t = {};
  function r(o, i) {
    let s = 0, a = 0, l = o.length, u = i[i.length - 1];
    return i.forEach((d, c) => {
      let f2 = Ut(e, d), h = f2 ? e.node(f2).order : l;
      (f2 || d === u) && (i.slice(a, c + 1).forEach((p) => {
        let E = e.predecessors(p);
        E && E.forEach((y) => {
          let L = e.node(y), b = L.order;
          (b < s || h < b) && !(L.dummy && e.node(p).dummy) && Gn(t, y, p);
        });
      }), a = c + 1, s = h);
    }), i;
  }
  return n.length && n.reduce(r), t;
}
function $t(e, n) {
  let t = {};
  function r(i, s, a, l, u) {
    A(s, a).forEach((d) => {
      let c = i[d];
      if (c !== void 0 && e.node(c).dummy) {
        let f2 = e.predecessors(c);
        f2 && f2.forEach((h) => {
          if (h === void 0) return;
          let p = e.node(h);
          p.dummy && (p.order < l || p.order > u) && Gn(t, h, c);
        });
      }
    });
  }
  function o(i, s) {
    let a = -1, l = -1, u = 0;
    return s.forEach((d, c) => {
      if (e.node(d).dummy === "border") {
        let f2 = e.predecessors(d);
        if (f2 && f2.length) {
          let h = f2[0];
          if (h === void 0) return;
          l = e.node(h).order, r(s, u, c, a, l), u = c, a = l;
        }
      }
      r(s, u, s.length, l, i.length);
    }), s;
  }
  return n.length && n.reduce(o), t;
}
function Ut(e, n) {
  if (e.node(n).dummy) {
    let t = e.predecessors(n);
    if (t) return t.find((r) => e.node(r).dummy);
  }
}
function Gn(e, n, t) {
  if (n > t) {
    let o = n;
    n = t, t = o;
  }
  let r = e[n];
  r || (e[n] = r = {}), r[t] = true;
}
function Jt(e, n, t) {
  if (n > t) {
    let o = n;
    n = t, t = o;
  }
  let r = e[n];
  return r !== void 0 && Object.hasOwn(r, t);
}
function Kt(e, n, t, r, o) {
  let i = {}, s = {}, a = {};
  return n.forEach((l) => {
    l.forEach((u, d) => {
      i[u] = u, s[u] = u, a[u] = d;
    });
  }), n.forEach((l) => {
    let u = -1, d = -1, c = false, f2 = l, h = l.findIndex((p) => (o == null ? void 0 : o.includes(p)) || Nn(p, e, o));
    h > 0 && (f2 = [l[h], ...l.slice(0, h), ...l.slice(h + 1)], c = true), f2.forEach((p) => {
      var y;
      let E = r(p);
      if (E && E.length) {
        o != null && o.includes(p) && (E = E.filter((g) => Nn(g, e, o)));
        let L = E.sort((g, m) => {
          let w = a[g], k = a[m];
          return (w !== void 0 ? w : 0) - (k !== void 0 ? k : 0);
        }), b = (L.length - 1) / 2;
        for (let g = Math.floor(b), m = Math.ceil(b); g <= m; ++g) {
          let w = L[g];
          if (w === void 0) continue;
          let k = a[w];
          if (k !== void 0 && s[p] === p && u < k && a[w] !== d && !Jt(t, p, w)) {
            let _ = i[w];
            _ !== void 0 && (s[w] = p, s[p] = i[p] = _, u = k, c && (u = -1, d = (y = a[w]) != null ? y : -1, c = false));
          }
        }
      }
    });
  }), { root: i, align: s };
}
function Qt(e, n, t, r, o = false) {
  let i = {}, s = Zt(e, n, t, o), a = o ? "borderLeft" : "borderRight";
  function l(h, p) {
    let E = s.nodes().slice(), y = {}, L = E.pop();
    for (; L; ) {
      if (y[L]) h(L);
      else {
        y[L] = true, E.push(L);
        for (let b of p(L)) E.push(b);
      }
      L = E.pop();
    }
  }
  function u(h) {
    let p = s.inEdges(h);
    p ? i[h] = p.reduce((E, y) => {
      var g;
      let L = (g = i[y.v]) != null ? g : 0, b = s.edge(y);
      return Math.max(E, L + (b !== void 0 ? b : 0));
    }, 0) : i[h] = 0;
  }
  function d(h) {
    let p = s.outEdges(h), E = Number.POSITIVE_INFINITY;
    p && (E = p.reduce((L, b) => {
      let g = i[b.w], m = s.edge(b);
      return Math.min(L, (g !== void 0 ? g : 0) - (m !== void 0 ? m : 0));
    }, Number.POSITIVE_INFINITY));
    let y = e.node(h);
    E !== Number.POSITIVE_INFINITY && y.borderType !== a && (i[h] = Math.max(i[h] !== void 0 ? i[h] : 0, E));
  }
  function c(h) {
    return s.predecessors(h) || [];
  }
  function f2(h) {
    return s.successors(h) || [];
  }
  return l(u, c), l(d, f2), Object.keys(r).forEach((h) => {
    var E;
    let p = t[h];
    p !== void 0 && (i[h] = (E = i[p]) != null ? E : 0);
  }), i;
}
function Zt(e, n, t, r) {
  let o = new T(), i = e.graph(), s = rr(i.nodesep, i.edgesep, r);
  return n.forEach((a) => {
    let l;
    a.forEach((u) => {
      let d = t[u];
      if (d !== void 0) {
        if (o.setNode(d), l !== void 0) {
          let c = t[l];
          if (c !== void 0) {
            let f2 = o.edge(c, d);
            o.setEdge(c, d, Math.max(s(e, u, l), f2 || 0));
          }
        }
        l = u;
      }
    });
  }), o;
}
function er(e, n) {
  return Object.values(n).reduce((t, r) => {
    let o = Number.NEGATIVE_INFINITY, i = Number.POSITIVE_INFINITY;
    Object.entries(r).forEach(([a, l]) => {
      let u = or(e, a) / 2;
      o = Math.max(l + u, o), i = Math.min(l - u, i);
    });
    let s = o - i;
    return s < t[0] && (t = [s, r]), t;
  }, [Number.POSITIVE_INFINITY, null])[1];
}
function nr(e, n) {
  let t = Object.values(n), r = R(Math.min, t), o = R(Math.max, t);
  ["u", "d"].forEach((i) => {
    ["l", "r"].forEach((s) => {
      let a = i + s, l = e[a];
      if (!l || l === n) return;
      let u = Object.values(l), d = r - R(Math.min, u);
      s !== "l" && (d = o - R(Math.max, u)), d && (e[a] = X(l, (c) => c + d));
    });
  });
}
function tr(e, n = void 0) {
  let t = e.ul;
  return t ? X(t, (r, o) => {
    var s, a;
    if (n) {
      let l = n.toLowerCase(), u = e[l];
      if (u && u[o] !== void 0) return u[o];
    }
    let i = Object.values(e).map((l) => {
      let u = l[o];
      return u !== void 0 ? u : 0;
    }).sort((l, u) => l - u);
    return (((s = i[1]) != null ? s : 0) + ((a = i[2]) != null ? a : 0)) / 2;
  }) : {};
}
function vn(e, n) {
  let t = P(e), r = Object.assign(qt(e, t), $t(e, t)), o = {}, i;
  ["u", "d"].forEach((a) => {
    i = a === "u" ? t : Object.values(t).reverse(), ["l", "r"].forEach((l) => {
      l === "r" && (i = i.map((f2) => Object.values(f2).reverse()));
      let d = Kt(e, i, r, (f2) => (a === "u" ? e.predecessors(f2) : e.successors(f2)) || [], n), c = Qt(e, i, d.root, d.align, l === "r");
      l === "r" && (c = X(c, (f2) => -f2)), o[a + l] = c;
    });
  });
  let s = er(e, o);
  return nr(o, s), tr(o, e.graph().align);
}
function rr(e, n, t) {
  return (r, o, i) => {
    let s = r.node(o), a = r.node(i), l = 0, u;
    if (l += s.width / 2, Object.hasOwn(s, "labelpos")) switch (s.labelpos.toLowerCase()) {
      case "l":
        u = -s.width / 2;
        break;
      case "r":
        u = s.width / 2;
        break;
    }
    if (u && (l += t ? u : -u), u = void 0, l += (s.dummy ? n : e) / 2, l += (a.dummy ? n : e) / 2, l += a.width / 2, Object.hasOwn(a, "labelpos")) switch (a.labelpos.toLowerCase()) {
      case "l":
        u = a.width / 2;
        break;
      case "r":
        u = -a.width / 2;
        break;
    }
    return u && (l += t ? u : -u), l;
  };
}
function or(e, n) {
  return e.node(n).width;
}
function Nn(e, n, t) {
  var s;
  if (!t) return false;
  let r = (s = n.node(e)) == null ? void 0 : s.edgeObj;
  if (!r || n.node(e).edgeLabel.reversed) return false;
  let o = t.indexOf(r == null ? void 0 : r.v), i = t.indexOf(r == null ? void 0 : r.w);
  return o !== -1 && i !== -1 && o === (i + 1) % t.length || o === (i - 1) % t.length;
}
function kn(e, n) {
  e = Z(e), ir(e), Object.entries(vn(e, n)).forEach(([t, r]) => e.node(t).x = r);
}
function ir(e) {
  let n = P(e), t = e.graph(), r = t.ranksep, o = t.rankalign, i = 0;
  n.forEach((s) => {
    let a = s.reduce((l, u) => {
      var c;
      let d = (c = e.node(u).height) != null ? c : 0;
      return l > d ? l : d;
    }, 0);
    s.forEach((l) => {
      let u = e.node(l);
      o === "top" ? u.y = i + u.height / 2 : o === "bottom" ? u.y = i + a - u.height / 2 : u.y = i + a / 2;
    }), i += a + r;
  });
}
var xn = /* @__PURE__ */ new WeakMap();
function Oe(e, n = {}) {
  return Rn(e, q, n), e;
}
function _n(e, n, t) {
  let r = n;
  for (; r !== void 0; ) {
    let o = e.parent(r);
    if (o === t) return r;
    r = o;
  }
}
function Rn(e, n, t) {
  var L;
  let r = e.nodes().filter((b) => e.children(b).length), o = {};
  r.forEach((b) => {
    let g = e.node(b);
    if (g && g.rankdir) {
      let m = new T({ multigraph: true, compound: true });
      m.setGraph({ rankdir: g.rankdir });
      let w = e.children(b);
      w.forEach((v) => {
        let N = { ...e.node(v) };
        m.setNode(v, N);
        let O = e.parent(v);
        O && O !== b && w.includes(O) && m.setParent(v, O);
      });
      let k = /* @__PURE__ */ new Set();
      e.edges().forEach((v) => {
        let N = _n(e, v.v, b), O = _n(e, v.w, b);
        if (N && O && N !== O) {
          let W = `${N}\0${O}`;
          k.has(W) || (k.add(W), m.setEdge(N, O, { ...e.edge(v) }));
        }
      }), Rn(m, n, t);
      let _ = jn(m);
      On(_, n, t, null), Cn(m, _);
      let C = 1 / 0, j = 1 / 0, I = -1 / 0, S = -1 / 0;
      m.nodes().forEach((v) => {
        if (v === b) return;
        let N = m.node(v);
        N && typeof N.x == "number" && typeof N.y == "number" && typeof N.width == "number" && typeof N.height == "number" && (C = Math.min(C, N.x - N.width / 2), I = Math.max(I, N.x + N.width / 2), j = Math.min(j, N.y - N.height / 2), S = Math.max(S, N.y + N.height / 2));
      }), (!isFinite(C) || !isFinite(j) || !isFinite(I) || !isFinite(S)) && (C = j = 0, I = S = 0);
      let G = I - C, x = S - j;
      o[b] = { minX: C, minY: j, maxX: I, maxY: S, width: G, height: x, offsetX: C, offsetY: j }, g._dagreClusterSubgraph = m;
    }
  });
  let i = [], s = (b) => {
    let g = [], m = (e.children(b) || []).filter((w) => w !== b);
    for (; m.length > 0; ) {
      let w = m.shift();
      g.push(w), (e.children(w) || []).filter((k) => k !== w).forEach((k) => m.push(k));
    }
    return g;
  }, a = /* @__PURE__ */ new Map();
  r.forEach((b) => {
    let g = e.node(b);
    g && g.rankdir && o[b] && a.set(b, (e.children(b) || []).filter((m) => m !== b));
  });
  let l = new Set([...a.values()].flat()), u = /* @__PURE__ */ new Map();
  a.forEach((b, g) => {
    l.has(g) || u.set(g, s(g));
  });
  let d = new Set([...u.values()].flat()), c = (b) => {
    for (let [g, m] of u) if (m.includes(b)) return g;
    return b;
  }, f2 = [];
  e.edges().forEach((b) => {
    (d.has(b.v) || d.has(b.w)) && f2.push({ edge: b, label: e.edge(b) });
  });
  let h = /* @__PURE__ */ new Map();
  d.forEach((b) => {
    let g = e.parent(b);
    h.set(b, typeof g == "string" ? g : void 0);
  }), u.forEach((b, g) => {
    let m = e.node(g), w = [];
    b.forEach((C) => {
      let j = e.node(C);
      j && (w.push({ id: C, node: j, parent: h.get(C) }), e.removeNode(C));
    });
    let k = f2.filter(({ edge: C }) => b.includes(C.v) || b.includes(C.w)), _ = o[g];
    m && (i.push({ clusterId: g, subgraph: m._dagreClusterSubgraph, bounds: _, children: b, removedNodes: w, removedEdges: k }), m.width = _.width, m.height = _.height);
  });
  let p = /* @__PURE__ */ new Set();
  f2.forEach(({ edge: b, label: g }) => {
    let m = c(b.v), w = c(b.w);
    if (m !== w && e.hasNode(m) && e.hasNode(w)) {
      let k = `${m}\0${w}`;
      p.has(k) || (p.add(k), e.setEdge(m, w, { ...g, width: 0, height: 0 }));
    }
  });
  let E = jn(e), y = On(E, n, t, (L = xn.get(e)) != null ? L : null);
  xn.set(e, y), Cn(e, E), p.forEach((b) => {
    let g = b.indexOf("\0"), m = b.slice(0, g), w = b.slice(g + 1);
    e.hasEdge(m, w) && e.removeEdge(m, w);
  }), i.forEach(({ clusterId: b, subgraph: g, bounds: m, removedNodes: w, removedEdges: k }) => {
    var G, x;
    let _ = e.node(b), C = (G = _ == null ? void 0 : _.x) != null ? G : 0, j = (x = _ == null ? void 0 : _.y) != null ? x : 0, I = (m.minX + m.maxX) / 2, S = (m.minY + m.maxY) / 2;
    w.forEach(({ id: v, node: N, parent: O }) => {
      e.setNode(v, N), O !== void 0 && e.setParent(v, O);
    }), k.forEach(({ edge: v, label: N }) => {
      e.setEdge(v, N);
    }), g.nodes().forEach((v) => {
      if (v === b) return;
      let N = g.node(v), O = e.node(v);
      O && N && typeof N.x == "number" && typeof N.y == "number" && (O.x = C + (N.x - I), O.y = j + (N.y - S));
    }), delete _._dagreClusterSubgraph;
  }), r.forEach((b) => {
    var w, k;
    let g = e.node(b), m = o[b];
    if (g && g.rankdir && g._dagreClusterSubgraph && m) {
      let _ = g._dagreClusterSubgraph, C = (w = g.x) != null ? w : 0, j = (k = g.y) != null ? k : 0, I = (m.minX + m.maxX) / 2, S = (m.minY + m.maxY) / 2;
      _.nodes().forEach((G) => {
        if (G === b) return;
        let x = _.node(G), v = e.node(G);
        if (v && x && typeof x.x == "number" && typeof x.y == "number") {
          let N = x.x - I, O = x.y - S;
          v.x = C + N, v.y = j + O;
        }
      }), delete g._dagreClusterSubgraph;
    }
  });
}
function On(e, n, t, r = null) {
  var l, u;
  let o = (t == null ? void 0 : t.useDynamic) !== false, i = o && (l = r == null ? void 0 : r.graph) != null ? l : null, s = o && (u = r == null ? void 0 : r.rawNodes) != null ? u : null;
  n("    makeSpaceForEdgeLabels", () => hr(e)), n("    removeSelfEdges", () => Nr(e)), n("    acyclic", () => Ue(e, i)), n("    nestingGraph.run", () => un(e)), n("    rank", () => dn(Z(e))), n("    injectEdgeLabelProxies", () => br(e)), n("    removeEmptyRanks", () => Be(e)), n("    nestingGraph.cleanup", () => fn(e)), n("    normalizeRanks", () => We(e)), n("    assignRankMinMax", () => gr(e)), n("    removeEdgeLabelProxies", () => pr(e)), n("    normalize.run", () => Ke(e)), n("    parentDummyChains", () => ln(e)), n("    addBorderSegments", () => bn(e)), n("    order", () => re(e, t, s)), n("    insertSelfEdges", () => Gr(e)), n("    adjustCoordinateSystem", () => pn(e)), n("    position", () => kn(e, t.corePath)), n("    positionSelfEdges", () => vr(e));
  let a = JSON.parse(JSON.stringify(e._nodes));
  return n("    removeBorderNodes", () => wr(e)), n("    normalize.undo", () => Qe(e)), n("    fixupEdgeLabelCoords", () => Lr(e)), n("    undoCoordinateSystem", () => mn(e)), n("    translateGraph", () => mr(e)), n("    assignNodeIntersects", () => Er(e)), n("    reversePoints", () => yr(e)), n("    acyclic.undo", () => Je(e)), { graph: e, rawNodes: a };
}
function Cn(e, n) {
  e.nodes().forEach((t) => {
    let r = e.node(t), o = n.node(t);
    r && (r.x = o.x, r.y = o.y, r.order = o.order, r.rank = o.rank, n.children(t).length && (r.width = o.width, r.height = o.height));
  }), e.edges().forEach((t) => {
    let r = e.edge(t), o = n.edge(t);
    r.points = o.points, Object.hasOwn(o, "x") && (r.x = o.x, r.y = o.y);
  }), e.graph().width = n.graph().width, e.graph().height = n.graph().height;
}
var sr = ["nodesep", "edgesep", "ranksep", "marginx", "marginy"];
var ar = { ranksep: 50, edgesep: 20, nodesep: 50, rankdir: "TB", rankalign: "center" };
var dr = ["acyclicer", "ranker", "rankdir", "align", "rankalign"];
var lr = ["width", "height", "rank"];
var Tn = { width: 0, height: 0 };
var ur = ["minlen", "weight", "width", "height", "labeloffset"];
var cr = { minlen: 1, weight: 1, width: 0, height: 0, labeloffset: 10, labelpos: "r" };
var fr = ["labelpos"];
function jn(e) {
  let n = new T({ multigraph: true, compound: true }), t = _e(e.graph());
  return n.setGraph(Object.assign({}, ar, xe(t, sr), B(t, dr))), e.nodes().forEach((r) => {
    let o = _e(e.node(r)), i = xe(o, lr);
    Object.keys(Tn).forEach((a) => {
      i[a] === void 0 && (i[a] = Tn[a]);
    }), n.setNode(r, i);
    let s = e.parent(r);
    s !== void 0 && n.setParent(r, s);
  }), e.edges().forEach((r) => {
    let o = _e(e.edge(r));
    n.setEdge(r, Object.assign({}, cr, xe(o, ur), B(o, fr)));
  }), n;
}
function hr(e) {
  let n = e.graph();
  n.ranksep /= 2, e.edges().forEach((t) => {
    var o;
    let r = e.edge(t);
    r.minlen *= 2, ((o = r.labelpos) != null ? o : "r").toLowerCase() !== "c" && (n.rankdir === "TB" || n.rankdir === "BT" ? r.width += r.labeloffset : r.height += r.labeloffset);
  });
}
function br(e) {
  e.edges().forEach((n) => {
    let t = e.edge(n);
    if (t.width && t.height) {
      let r = e.node(n.v), i = { rank: (e.node(n.w).rank - r.rank) / 2 + r.rank, e: n };
      M(e, "edge-proxy", i, "_ep");
    }
  });
}
function gr(e) {
  let n = 0;
  e.nodes().forEach((t) => {
    let r = e.node(t);
    r.borderTop && (r.minRank = e.node(r.borderTop).rank, r.maxRank = e.node(r.borderBottom).rank, n = Math.max(n, r.maxRank));
  }), e.graph().maxRank = n;
}
function pr(e) {
  e.nodes().forEach((n) => {
    let t = e.node(n);
    if (t.dummy === "edge-proxy") {
      let r = t;
      e.edge(r.e).labelRank = t.rank, e.removeNode(n);
    }
  });
}
function mr(e) {
  let n = Number.POSITIVE_INFINITY, t = 0, r = Number.POSITIVE_INFINITY, o = 0, i = e.graph(), s = i.marginx || 0, a = i.marginy || 0;
  function l(u) {
    let d = u.x, c = u.y, f2 = u.width, h = u.height;
    n = Math.min(n, d - f2 / 2), t = Math.max(t, d + f2 / 2), r = Math.min(r, c - h / 2), o = Math.max(o, c + h / 2);
  }
  e.nodes().forEach((u) => l(e.node(u))), e.edges().forEach((u) => {
    let d = e.edge(u);
    Object.hasOwn(d, "x") && l(d);
  }), n -= s, r -= a, e.nodes().forEach((u) => {
    let d = e.node(u);
    d.x -= n, d.y -= r;
  }), e.edges().forEach((u) => {
    let d = e.edge(u);
    d.points.forEach((c) => {
      c.x -= n, c.y -= r;
    }), Object.hasOwn(d, "x") && (d.x -= n), Object.hasOwn(d, "y") && (d.y -= r);
  }), i.width = t - n + s, i.height = o - r + a;
}
function Er(e) {
  e.edges().forEach((n) => {
    if (n.v === n.w) return;
    let t = e.edge(n), r = e.node(n.v), o = e.node(n.w), i, s;
    t.points ? (i = t.points[0], s = t.points[t.points.length - 1]) : (t.points = [], i = o, s = r), t.points.unshift(se(r, i)), t.points.push(se(o, s));
  });
}
function Lr(e) {
  e.edges().forEach((n) => {
    let t = e.edge(n);
    if (Object.hasOwn(t, "x")) switch ((t.labelpos === "l" || t.labelpos === "r") && (t.width -= t.labeloffset), t.labelpos) {
      case "l":
        t.x -= t.width / 2 + t.labeloffset;
        break;
      case "r":
        t.x += t.width / 2 + t.labeloffset;
        break;
    }
  });
}
function yr(e) {
  e.edges().forEach((n) => {
    let t = e.edge(n);
    t.reversed && t.points.reverse();
  });
}
function wr(e) {
  e.nodes().forEach((n) => {
    if (e.children(n).length) {
      let t = e.node(n), r = e.node(t.borderTop), o = e.node(t.borderBottom), i = e.node(t.borderLeft[t.borderLeft.length - 1]), s = e.node(t.borderRight[t.borderRight.length - 1]);
      t.width = Math.abs(s.x - i.x), t.height = Math.abs(o.y - r.y), t.x = i.x + t.width / 2, t.y = r.y + t.height / 2;
    }
  }), e.nodes().forEach((n) => {
    e.node(n).dummy === "border" && e.removeNode(n);
  });
}
function Nr(e) {
  e.edges().forEach((n) => {
    if (n.v === n.w) {
      let t = e.node(n.v);
      t.selfEdges || (t.selfEdges = []), t.selfEdges.push({ e: n, label: e.edge(n) }), e.removeEdge(n);
    }
  });
}
function Gr(e) {
  P(e).forEach((t) => {
    let r = 0;
    t.forEach((o, i) => {
      let s = e.node(o);
      typeof s.rank != "number" && (s.rank = 0), s.order = i + r, (s.selfEdges || []).forEach((a) => {
        M(e, "selfedge", { width: a.label.width, height: a.label.height, rank: s.rank, order: i + ++r, e: a.e, edgeLabel: a.label }, "_se"), (!Array.isArray(a.label.points) || a.label.points.length !== 7) && (a.label.points = [{ x: 0, y: -10 }, { x: 0, y: -10 }, { x: 0, y: 0 }, { x: 0, y: 10 }, { x: 0, y: 10 }, { x: 0, y: 0 }, { x: 0, y: 0 }]);
      }), delete s.selfEdges;
    });
  });
}
function vr(e) {
  e.nodes().forEach((n) => {
    let t = e.node(n), r = (o) => typeof o == "number" && isFinite(o);
    if (t.dummy === "selfedge") {
      let o = t, i = e.node(o.e.v), s = r(i == null ? void 0 : i.x) ? i.x : 0, a = r(i == null ? void 0 : i.y) ? i.y : 0, l = r(i == null ? void 0 : i.width) ? i.width : 0, u = r(i == null ? void 0 : i.height) ? i.height : 0, d = r(t.x) ? t.x : s, c = r(t.y) ? t.y : a, f2 = l / 2, h = u / 2;
      o.edgeLabel.points = [{ x: d + f2, y: c - h }, { x: d + f2, y: c - h }, { x: d, y: c }, { x: d - f2, y: c + h }, { x: d - f2, y: c + h }, { x: d, y: c }, { x: d, y: c }], o.edgeLabel.x = d, o.edgeLabel.y = c, e.setEdge(o.e, o.edgeLabel), e.removeNode(n);
    } else t && Array.isArray(t.selfEdges) && t.selfEdges.forEach((o) => {
      if (!Array.isArray(o.label.points) || o.label.points.length !== 7) {
        let i = r(t.x) ? t.x : 0, s = r(t.y) ? t.y : 0, a = r(t.width) ? t.width : 0, l = r(t.height) ? t.height : 0, u = a / 2, d = l / 2;
        o.label.points = [{ x: i + u, y: s - d }, { x: i + u, y: s - d }, { x: i, y: s }, { x: i - u, y: s + d }, { x: i - u, y: s + d }, { x: i, y: s }, { x: i, y: s }];
      }
    });
  });
}
function xe(e, n) {
  return X(B(e, n), Number);
}
function _e(e) {
  let n = {};
  return e && Object.entries(e).forEach(([t, r]) => {
    typeof t == "string" && (t = t.toLowerCase()), n[t] = r;
  }), n;
}
function Ce(e) {
  let n = P(e), t = new T({ compound: true, multigraph: true }).setGraph({});
  return e.nodes().forEach((r) => {
    t.setNode(r, { label: r }), t.setParent(r, "layer" + e.node(r).rank);
  }), e.edges().forEach((r) => t.setEdge(r.v, r.w, {}, r.name)), n.forEach((r, o) => {
    let i = "layer" + o;
    t.setNode(i, { rank: "same" }), r.reduce((s, a) => (t.setEdge(s, a, { style: "invis" }), a));
  }), t;
}
var kr = { graphlib: ie, version: ue, layout: Oe, debug: Ce, util: { time: le, notime: q } };
var $o = kr;

// ../../packages/doodleppl/src/render/layout.ts
var NODE_HEIGHT = 40;
var CHAR_WIDTH = 7.4;
var PLATE_PADDING = 28;
function nodeLabel(node) {
  return node.indices ? `${node.name}[${node.indices}]` : node.name;
}
var nodeWidth = (node) => Math.max(60, nodeLabel(node).length * CHAR_WIDTH + 24);
function layoutGraph(elements, options = {}) {
  const nodes = elements.filter((e) => e.type === "node");
  const edges = elements.filter((e) => e.type === "edge");
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const g = new $o.graphlib.Graph({ compound: true, directed: true, multigraph: false });
  g.setGraph({
    rankdir: options.rankdir ?? "TB",
    nodesep: options.nodesep ?? 36,
    ranksep: options.ranksep ?? 48,
    marginx: 20,
    marginy: 20
  });
  g.setDefaultEdgeLabel(() => ({}));
  for (const n of nodes) {
    if (n.nodeType === "plate") {
      g.setNode(n.id, {
        width: 0,
        height: 0,
        paddingLeft: PLATE_PADDING,
        paddingRight: PLATE_PADDING,
        paddingTop: PLATE_PADDING,
        paddingBottom: PLATE_PADDING + 8
      });
    } else {
      g.setNode(n.id, { width: nodeWidth(n), height: NODE_HEIGHT });
    }
  }
  for (const n of nodes) {
    if (n.parent && byId.has(n.parent)) g.setParent(n.id, n.parent);
  }
  for (const e of edges) {
    if (byId.has(e.source) && byId.has(e.target)) g.setEdge(e.source, e.target);
  }
  $o.layout(g);
  const placed = (n) => {
    const l = g.node(n.id);
    return { node: n, x: l.x ?? 0, y: l.y ?? 0, width: l.width, height: l.height };
  };
  const depth = (n) => {
    let d = 0;
    for (let p = n.parent ? byId.get(n.parent) : void 0; p; p = p.parent ? byId.get(p.parent) : void 0)
      d++;
    return d;
  };
  const plates = nodes.filter((n) => n.nodeType === "plate").sort((a, b) => depth(a) - depth(b)).map(placed);
  const label = g.graph();
  return {
    width: label.width ?? 0,
    height: label.height ?? 0,
    nodes: nodes.filter((n) => n.nodeType !== "plate").map(placed),
    plates,
    edges: edges.filter((e) => byId.has(e.source) && byId.has(e.target)).map((e) => ({ edge: e, points: g.edge(e.source, e.target).points ?? [] }))
  };
}
function applyLayout(elements, layout) {
  const pos = /* @__PURE__ */ new Map();
  for (const p of [...layout.nodes, ...layout.plates]) pos.set(p.node.id, { x: p.x, y: p.y });
  return elements.map((e) => {
    const at2 = e.type === "node" ? pos.get(e.id) : void 0;
    return at2 ? { ...e, position: { x: Math.round(at2.x), y: Math.round(at2.y) } } : e;
  });
}

// ../../packages/doodleppl/src/render/svg.ts
var palette = (theme) => {
  if (theme === "light")
    return { fg: "#222", bg: "#fff", muted: "#777", observed: "#dcdcdc", plate: "#f3f3f3" };
  if (theme === "dark")
    return {
      fg: "#e6e6e6",
      bg: "#1b1b1b",
      muted: "#9a9a9a",
      observed: "#3a3a3a",
      plate: "#262626"
    };
  return {
    fg: "var(--mcmc-fg,#222)",
    bg: "var(--mcmc-bg,#fff)",
    muted: "var(--mcmc-muted,#777)",
    observed: "var(--mcmc-observed,#dcdcdc)",
    plate: "var(--mcmc-plate,#f3f3f3)"
  };
};
var esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
var f = (n) => n.toFixed(1);
function shape(p, c) {
  const { node } = p;
  const rx = p.width / 2;
  const ry = p.height / 2;
  if (node.nodeType === "constant") {
    return `<rect x="${f(p.x - rx)}" y="${f(p.y - ry)}" width="${f(p.width)}" height="${f(p.height)}" fill="${c.bg}" stroke="${c.fg}" stroke-width="1.5"/>`;
  }
  const fill = node.nodeType === "observed" ? c.observed : c.bg;
  const dash = node.nodeType === "deterministic" ? ' stroke-dasharray="5 3"' : "";
  return `<ellipse cx="${f(p.x)}" cy="${f(p.y)}" rx="${f(rx)}" ry="${f(ry)}" fill="${fill}" stroke="${c.fg}" stroke-width="1.5"${dash}/>`;
}
function path(points) {
  if (points.length === 0) return "";
  const [first, ...rest] = points;
  if (!first) return "";
  return `M ${f(first.x)} ${f(first.y)} ${rest.map((q2) => `L ${f(q2.x)} ${f(q2.y)}`).join(" ")}`;
}
function renderGraphSvg(layout, options = {}) {
  const c = palette(options.theme ?? "tokens");
  const font = options.fontFamily ?? "system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
  const w = Math.ceil(layout.width);
  const h = Math.ceil(layout.height);
  const deterministic = new Set(
    layout.nodes.filter((n) => n.node.nodeType === "deterministic").map((n) => n.node.id)
  );
  const out = [];
  out.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" font-family="${esc(font)}" font-size="13">`
  );
  out.push(
    `<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="${c.fg}"/></marker></defs>`
  );
  out.push(`<rect width="100%" height="100%" fill="${c.bg}"/>`);
  for (const p of layout.plates) {
    const x = p.x - p.width / 2;
    const y = p.y - p.height / 2;
    out.push(
      `<rect x="${f(x)}" y="${f(y)}" width="${f(p.width)}" height="${f(p.height)}" rx="8" fill="${c.plate}" stroke="${c.muted}" stroke-width="1"/>`
    );
    const loop = `for ${p.node.loopVariable ?? ""} in ${p.node.loopRange ?? ""}`;
    out.push(
      `<text x="${f(x + p.width - 8)}" y="${f(y + p.height - 8)}" text-anchor="end" fill="${c.muted}" font-size="11">${esc(loop)}</text>`
    );
  }
  for (const e of layout.edges) {
    const d = path(e.points);
    if (!d) continue;
    const dash = deterministic.has(e.edge.target) ? ' stroke-dasharray="5 3"' : "";
    out.push(
      `<path d="${d}" fill="none" stroke="${c.fg}" stroke-width="1.3" marker-end="url(#arrow)"${dash}/>`
    );
  }
  for (const p of layout.nodes) {
    out.push(shape(p, c));
    out.push(
      `<text x="${f(p.x)}" y="${f(p.y)}" text-anchor="middle" dominant-baseline="central" fill="${c.fg}">${esc(nodeLabel(p.node))}</text>`
    );
  }
  out.push("</svg>");
  return `${out.join("\n")}
`;
}

// ../../packages/doodleppl/src/core/topo-sort.ts
function buildTopologicalOrder(nodes, edges) {
  const inDegree = {};
  const adjacency = {};
  for (const node of nodes) {
    inDegree[node.id] = 0;
    adjacency[node.id] = [];
  }
  for (const edge of edges) {
    const out = adjacency[edge.source];
    const deg = inDegree[edge.target];
    if (out && deg !== void 0) {
      out.push(edge.target);
      inDegree[edge.target] = deg + 1;
    }
  }
  const queue = nodes.filter((n) => inDegree[n.id] === 0).map((n) => n.id);
  const sorted = [];
  while (queue.length > 0) {
    const id = queue.shift();
    sorted.push(id);
    for (const child of adjacency[id] ?? []) {
      const deg = inDegree[child];
      if (deg !== void 0) {
        inDegree[child] = deg - 1;
        if (deg - 1 === 0) queue.push(child);
      }
    }
  }
  return sorted;
}

// ../../packages/doodleppl/src/codegen/bugs.ts
function generateBugsModel(elements) {
  const nodes = elements.filter((el) => el.type === "node");
  const edges = elements.filter((el) => el.type === "edge");
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const nameToNode = new Map(nodes.map((n) => [n.name, n]));
  if (nodes.length === 0) return "model {\n}";
  const sortedNodeIds = buildTopologicalOrder(nodes, edges);
  const treeRoot = { id: "root", type: "plate", children: [] };
  const treeMemberMap = /* @__PURE__ */ new Map([["root", treeRoot]]);
  for (const node of nodes) {
    treeMemberMap.set(node.id, {
      id: node.id,
      type: node.nodeType === "plate" ? "plate" : "node",
      children: []
    });
  }
  for (const node of nodes) {
    const parentMember = treeMemberMap.get(node.parent ?? "root");
    const childMember = treeMemberMap.get(node.id);
    if (parentMember && childMember) parentMember.children.push(childMember);
  }
  const formatParam = (raw) => {
    const p = raw.trim();
    if (!p) return p;
    if (/\[[^\]]+\]\s*$/.test(p)) return p;
    if (/^[+-]?(?:\d+\.?\d*|\d*\.\d+)(?:[eE][+-]?\d+)?$/.test(p) || /[()]/.test(p)) return p;
    const ref = nameToNode.get(p);
    if (ref?.indices && ref.indices.trim() !== "") return `${p}[${ref.indices}]`;
    return p;
  };
  const paramsOf = (node) => [node.param1, node.param2, node.param3].filter((p) => p !== void 0 && p.trim() !== "").map(formatParam).join(", ");
  const generate = (member, indentLevel) => {
    const lines = [];
    const indent = "  ".repeat(indentLevel);
    const sortedChildren = [...member.children].sort((a, b) => {
      if (a.type === "plate" && b.type !== "plate") return -1;
      if (b.type === "plate" && a.type !== "plate") return 1;
      const na = a.type === "node" ? nodeMap.get(a.id) : void 0;
      const nb = b.type === "node" ? nodeMap.get(b.id) : void 0;
      const pa = na?.nodeType === "deterministic" ? 1 : 0;
      const pb = nb?.nodeType === "deterministic" ? 1 : 0;
      if (pa !== pb) return pa - pb;
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

// ../../packages/doodleppl/src/core/discrete-analysis.ts
var DISCRETE_DISTRIBUTIONS = /* @__PURE__ */ new Set([
  "dbern",
  "dbin",
  "dpois",
  "dcat",
  "dnegbin",
  "dgeom",
  "dhyper",
  "dbetabin"
]);
var MARGINALIZABLE_DISTS = /* @__PURE__ */ new Set(["dcat", "dbern", "dbin"]);
var FRONTIER_COST_WARN = 1e4;
var IDENT_RE = /(?<![0-9.])([A-Za-z_][A-Za-z0-9_.]*)\s*(\[([^\]]*)\])?/g;
function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function nodeExprs(node) {
  const vals = [node.equation, node.param1, node.param2, node.param3];
  return vals.filter((v) => v !== void 0 && String(v).trim() !== "").map(String);
}
function referencedNames2(node) {
  const names = /* @__PURE__ */ new Set();
  for (const expr2 of nodeExprs(node)) {
    IDENT_RE.lastIndex = 0;
    let m = IDENT_RE.exec(expr2);
    while (m !== null) {
      const after = expr2.charAt(m.index + m[1].length);
      if (after !== "(") names.add(m[1]);
      m = IDENT_RE.exec(expr2);
    }
  }
  return names;
}
function buildCtx(elements) {
  const nodes = elements.filter((el) => el.type === "node");
  const edges = elements.filter((el) => el.type === "edge");
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const nonPlate = nodes.filter((n) => n.nodeType !== "plate");
  const nameToNode = new Map(nonPlate.map((n) => [n.name, n]));
  const parents = /* @__PURE__ */ new Map();
  for (const n of nodes) parents.set(n.id, /* @__PURE__ */ new Set());
  for (const e of edges) {
    if (nodeMap.has(e.source) && nodeMap.has(e.target)) {
      parents.get(e.target)?.add(e.source);
    }
  }
  for (const n of nodes) {
    if (n.nodeType === "plate") continue;
    for (const name of referencedNames2(n)) {
      const ref = nameToNode.get(name);
      if (ref && ref.id !== n.id) parents.get(n.id)?.add(ref.id);
    }
  }
  return { nodes, nodeMap, nameToNode, nodeNames: new Set(nonPlate.map((n) => n.name)), parents };
}
function discreteScope(node, ctx, targetIds) {
  const scope = /* @__PURE__ */ new Set();
  const stack = [...ctx.parents.get(node.id) ?? []];
  const seen = /* @__PURE__ */ new Set();
  while (stack.length > 0) {
    const id = stack.pop();
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
function detsEnRoute(node, ctx, latentIds) {
  const dets = [];
  const stack = [...ctx.parents.get(node.id) ?? []];
  const seen = /* @__PURE__ */ new Set();
  while (stack.length > 0) {
    const id = stack.pop();
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
function splitTopLevelCommas(text) {
  const parts = [];
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
function parseIndexedRef(text) {
  const m = text.match(/^([A-Za-z_][A-Za-z0-9_.]*)\s*\[(.*)\]$/s);
  if (!m) return null;
  let depth = 0;
  for (const ch of m[2]) {
    if (ch === "[") depth++;
    else if (ch === "]") depth--;
    if (depth < 0) return null;
  }
  return depth === 0 ? { base: m[1], subs: splitTopLevelCommas(m[2]) } : null;
}
function resolveSupport(node, ctx) {
  if (node.distribution === "dbern") return { size: "2", lo: 0 };
  if (node.distribution === "dbin") {
    const n = node.param2 ? String(node.param2).trim() : "";
    if (/^\d+$/.test(n)) return { size: String(Number(n) + 1), lo: 0 };
    if (/^[A-Za-z_][A-Za-z0-9_.]*$/.test(n)) {
      const ref = ctx.nameToNode.get(n);
      if (ref && ref.nodeType !== "constant") return null;
      return { size: `(${n} + 1)`, lo: 0 };
    }
    return null;
  }
  const raw = node.param1 ? String(node.param1).trim() : "";
  if (!raw) return null;
  const idxMatch = parseIndexedRef(raw);
  if (idxMatch) {
    const subs = idxMatch.subs;
    const last = subs[subs.length - 1] ?? "";
    const range = last.match(/^(\S+)\s*:\s*(\S+)$/);
    if (range) {
      const a = range[1];
      const b = range[2];
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
function resolveSupportFromRef(name, ctx) {
  const ref = ctx.nameToNode.get(name);
  if (!ref) return null;
  if (ref.distribution === "ddirich") {
    const p1 = ref.param1 ? String(ref.param1).trim() : "";
    const dim = p1.match(/\[1:(\w+)\]/) || p1.match(/\[(\d+)\]/);
    if (dim) return { size: dim[1], lo: 1 };
  }
  const idx = ref.indices?.trim() ?? "";
  const range = idx.match(/^1\s*:\s*(\S+)$/);
  if (range) return { size: range[1], lo: 1 };
  return null;
}
function plateOf(node, ctx) {
  const parent = node.parent ? ctx.nodeMap.get(node.parent) : void 0;
  return parent?.nodeType === "plate" ? parent : void 0;
}
function platesOf(node, ctx) {
  const plates = [];
  const seen = /* @__PURE__ */ new Set([node.id]);
  let current = node;
  while (current) {
    const plate = plateOf(current, ctx);
    if (!plate || seen.has(plate.id)) break;
    seen.add(plate.id);
    plates.unshift(plate);
    current = plate;
  }
  return plates;
}
var loopVarOf = (plate) => plate.loopVariable || "i";
var plateIndexList = (plates) => plates.map(loopVarOf).join(",");
var normalizeIndices = (indices) => (indices ?? "").split(",").map((s) => s.trim()).join(",");
function nodeIndexList(node) {
  const declared = (node.indices ?? "").trim();
  const inName = node.name.match(/\[([^\]]*)\]/);
  const raw = declared !== "" ? declared : inName?.[1] ?? "";
  return raw.split(",").map((s) => s.trim()).filter((s) => s !== "");
}
function hasOffsetRef(node, name, loopVar) {
  const re2 = new RegExp(
    `(?<![A-Za-z0-9_])${escapeRe(name)}\\s*\\[[^\\]]*\\b${escapeRe(loopVar)}\\s*[+-][^\\]]*\\]`
  );
  return nodeExprs(node).some((e) => re2.test(e));
}
function referencesAreSubstitutable(exprs, latentName, indexList) {
  const re2 = new RegExp(
    `(?<![A-Za-z0-9_.])${escapeRe(latentName)}(?![A-Za-z0-9_])(\\s*\\[([^\\]]*)\\])?`,
    "g"
  );
  for (const expr2 of exprs) {
    re2.lastIndex = 0;
    let m = re2.exec(expr2);
    while (m !== null) {
      const sub = m[2];
      if (indexList === null) {
        if (sub !== void 0) return false;
      } else if (sub === void 0 || normalizeIndices(sub) !== indexList) {
        return false;
      }
      m = re2.exec(expr2);
    }
  }
  return true;
}
function helperNameCollision(name, ctx) {
  const helpers = [
    `${name}_lp`,
    `${name}_val`,
    `${name}_idx`,
    `${name}_obs`,
    `${name}_is_obs`,
    `phi_${name}`,
    `marg_conf_${name}`
  ];
  for (const h of helpers) {
    if (ctx.nodeNames.has(h)) return h;
  }
  for (const global of ["marg_joint_lp", "marg_c", "marg_pick"]) {
    if (ctx.nodeNames.has(global)) return global;
  }
  return null;
}
function scalarEliminationOrder(scalarLatents, ctx, topoIndex, scopes) {
  const latentSet = new Set(scalarLatents.map((n) => n.id));
  const placed = /* @__PURE__ */ new Set();
  const order = [];
  const byTopo = (a, b) => (topoIndex.get(a) ?? 0) - (topoIndex.get(b) ?? 0);
  const observed = ctx.nodes.filter((n) => n.nodeType === "observed").sort((a, b) => byTopo(a.id, b.id));
  for (const obs of observed) {
    const scope = [...scopes.get(obs.id) ?? []].filter((id) => latentSet.has(id) && !placed.has(id)).sort(byTopo);
    for (const id of scope) {
      placed.add(id);
      order.push(ctx.nodeMap.get(id));
    }
  }
  const remaining = scalarLatents.filter((n) => !placed.has(n.id)).sort((a, b) => byTopo(a.id, b.id));
  order.push(...remaining);
  return order;
}
function selfRefOffset(node, name, loopVar) {
  const re2 = new RegExp(
    `(?<![A-Za-z0-9_])${escapeRe(name)}\\s*\\[\\s*${escapeRe(loopVar)}\\s*-\\s*(\\d+)\\s*\\]`
  );
  for (const expr2 of nodeExprs(node)) {
    const m = expr2.match(re2);
    if (m) return Number(m[1]);
  }
  return null;
}
function plateBounds(plate) {
  const parts = (plate.loopRange || "1:N").split(":").map((s) => s.trim());
  return parts.length === 2 ? { lo: parts[0], hi: parts[1] } : null;
}
function detectChain(group, ctx, candidateIds, canTranslate) {
  if (group.length !== 2) return null;
  const inPlate = group.filter((l) => plateOf(l.node, ctx) !== void 0);
  const seeds = group.filter((l) => plateOf(l.node, ctx) === void 0);
  if (inPlate.length !== 1 || seeds.length !== 1) return null;
  const transition = inPlate[0];
  const init = seeds[0];
  const plate = plateOf(transition.node, ctx);
  const loopVar = loopVarOf(plate);
  const offset = selfRefOffset(transition.node, transition.node.name, loopVar);
  if (offset === null) return null;
  const name = transition.node.name;
  const bounds = plateBounds(plate);
  const firstIndex = nodeIndexList(init.node);
  const first = Number(firstIndex[0]);
  if (!bounds || firstIndex.length !== 1 || !Number.isInteger(first) || normalizeIndices(transition.node.indices) !== loopVar) {
    return { reason: `'${name}' is a chain in a shape the marginalizer does not handle` };
  }
  if (offset !== 1) {
    return { reason: `'${name}' looks back ${offset} steps; only one step is handled` };
  }
  if (Number(bounds.lo) !== first + 1) {
    return {
      reason: `'${name}' is seeded at ${first} but its plate starts at ${bounds.lo}`
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
  const chainIds = new Set(group.map((l) => l.node.id));
  const emissions = [];
  for (const node of ctx.nodes) {
    if (chainIds.has(node.id)) continue;
    if (node.nodeType !== "stochastic" && node.nodeType !== "observed") continue;
    const readsChain = [...discreteScope(node, ctx, chainIds) ?? []].length > 0;
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
    if (factorPlate === void 0 && indices.length === 1 && /^\d+$/.test(indices[0])) {
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
    if (factorPlate === void 0 || plateOf(factorPlate, ctx) !== void 0) {
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
  const dets = dedupe(
    [...emissions.map((em) => em.node), ...group.map((l) => l.node)].flatMap(
      (n) => detsEnRoute(n, ctx, chainIds)
    )
  );
  if (dets.length > 0) {
    return {
      reason: `'${name}' reaches a factor through the deterministic node '${dets[0].name}'`
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
      inlineDets: []
    }
  };
}
function analyzeDiscreteLatents(elements, topoOrder, options = {}) {
  const ctx = buildCtx(elements);
  const topoIndex = new Map(topoOrder.map((id, i) => [id, i]));
  const canTranslate = options.canTranslate ?? (() => true);
  const partialIds = options.partialIds ?? /* @__PURE__ */ new Set();
  const issues = [];
  const candidates = ctx.nodes.filter(
    (n) => (n.nodeType === "stochastic" || n.nodeType === "observed" && partialIds.has(n.id)) && n.distribution !== void 0 && MARGINALIZABLE_DISTS.has(n.distribution) && /^[A-Za-z_][A-Za-z0-9_]*$/.test(n.name)
  );
  const candidateIds = new Set(candidates.map((n) => n.id));
  const scopes = /* @__PURE__ */ new Map();
  for (const n of ctx.nodes) {
    if (n.nodeType === "stochastic" || n.nodeType === "observed") {
      scopes.set(n.id, discreteScope(n, ctx, candidateIds));
    }
  }
  const factorsOf = (latentId) => ctx.nodes.filter(
    (n) => n.id !== latentId && (n.nodeType === "stochastic" || n.nodeType === "observed") && (scopes.get(n.id)?.has(latentId) ?? false)
  );
  const latents = [];
  for (const latent of candidates) {
    const partial = partialIds.has(latent.id);
    const plate = plateOf(latent, ctx);
    if (partial && !plate) {
      latents.push({
        node: latent,
        tier: "unsupported",
        support: null,
        partial,
        reason: `partially observed '${latent.name}' is only supported inside a plate`
      });
      continue;
    }
    const support = resolveSupport(latent, ctx);
    const enclosing = platesOf(latent, ctx);
    if (enclosing.some((p) => hasOffsetRef(latent, latent.name, loopVarOf(p)))) {
      latents.push({
        node: latent,
        tier: "unsupported",
        support,
        partial,
        reason: `'${latent.name}' depends on itself across plate iterations (chain structure)`
      });
      continue;
    }
    if (!support) {
      latents.push({
        node: latent,
        tier: "unsupported",
        support: null,
        partial,
        reason: `support size of '${latent.name}' could not be resolved from its parameters`
      });
      continue;
    }
    latents.push({ node: latent, tier: plate ? "iid-plate" : "scalar-dag", support, partial });
  }
  const chainPlans = [];
  const byName = /* @__PURE__ */ new Map();
  for (const entry of latents) {
    byName.set(entry.node.name, [...byName.get(entry.node.name) ?? [], entry]);
  }
  for (const group of byName.values()) {
    const outcome = detectChain(group, ctx, candidateIds, canTranslate);
    if (outcome === null) continue;
    for (const entry of group) {
      if ("plan" in outcome) {
        entry.tier = "chain";
        entry.reason = void 0;
      } else {
        entry.tier = "unsupported";
        entry.reason = outcome.reason;
      }
    }
    if ("plan" in outcome) chainPlans.push(outcome.plan);
  }
  const byId = new Map(latents.map((l) => [l.node.id, l]));
  const isSupported = (id) => (byId.get(id)?.tier ?? "unsupported") !== "unsupported";
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
        canTranslate
      );
      if (fail) {
        entry.tier = "unsupported";
        entry.reason = fail;
        changed = true;
      }
    }
  }
  const survivingChains = chainPlans.filter(
    (plan) => byId.get(plan.transition.id)?.tier === "chain"
  );
  const consumedFactorIds = /* @__PURE__ */ new Set();
  const inlinedDetIds = /* @__PURE__ */ new Set();
  const platePlans = [];
  const scalarLatents = [];
  for (const entry of latents) {
    if (entry.tier === "iid-plate") {
      const factors = factorsOf(entry.node.id);
      platePlans.push({
        latent: entry.node,
        plates: platesOf(entry.node, ctx),
        support: entry.support,
        partial: entry.partial,
        factors,
        inlineDets: dedupe(factors.flatMap((f2) => detsEnRoute(f2, ctx, candidateIds)))
      });
    } else if (entry.tier === "scalar-dag") {
      scalarLatents.push(entry.node);
    }
  }
  for (const plan of platePlans) {
    consumedFactorIds.add(plan.latent.id);
    for (const f2 of plan.factors) consumedFactorIds.add(f2.id);
    for (const d of plan.inlineDets) inlinedDetIds.add(d.id);
  }
  for (const plan of survivingChains) {
    consumedFactorIds.add(plan.init.id);
    consumedFactorIds.add(plan.transition.id);
    for (const em of plan.emissions) consumedFactorIds.add(em.node.id);
  }
  let scalarPlan = null;
  if (scalarLatents.length > 0) {
    const order = scalarEliminationOrder(scalarLatents, ctx, topoIndex, scopes);
    const scalarIds = new Set(order.map((n) => n.id));
    const supportOf = (id) => byId.get(id).support;
    const allFactors = ctx.nodes.filter(
      (n) => (n.nodeType === "stochastic" || n.nodeType === "observed") && !scalarIds.has(n.id) && [...scopes.get(n.id) ?? []].some((id) => scalarIds.has(id))
    );
    const pending = [];
    for (const latent of order) {
      const priorScope = new Set(
        [...scopes.get(latent.id) ?? []].filter((id) => scalarIds.has(id))
      );
      priorScope.add(latent.id);
      pending.push({ kind: "factor", node: latent, scope: priorScope });
    }
    for (const f2 of allFactors) {
      pending.push({
        kind: "factor",
        node: f2,
        scope: new Set([...scopes.get(f2.id) ?? []].filter((id) => scalarIds.has(id)))
      });
    }
    const steps = [];
    for (const latent of [...order].reverse()) {
      const bucket = pending.filter((p) => p.scope.has(latent.id));
      const rest = pending.filter((p) => !p.scope.has(latent.id));
      const scopeAfter = /* @__PURE__ */ new Set();
      for (const p of bucket) {
        for (const id of p.scope) if (id !== latent.id) scopeAfter.add(id);
      }
      steps.push({
        latent,
        support: supportOf(latent.id),
        bucketFactors: bucket.filter((p) => p.kind === "factor").map((p) => p.node),
        bucketPhis: bucket.filter((p) => p.kind === "phi").map((p) => p.latent),
        scopeAfter: [...scopeAfter].map((id) => ctx.nodeMap.get(id))
      });
      pending.length = 0;
      pending.push(...rest, { kind: "phi", latent, scope: scopeAfter });
    }
    scalarPlan = {
      latents: order,
      steps,
      factors: allFactors,
      inlineDets: dedupe(
        [...allFactors, ...order].flatMap((f2) => detsEnRoute(f2, ctx, candidateIds))
      )
    };
    for (const latent of order) consumedFactorIds.add(latent.id);
    for (const f2 of allFactors) consumedFactorIds.add(f2.id);
    for (const d of scalarPlan.inlineDets) inlinedDetIds.add(d.id);
    for (const step of steps) {
      const sizes = [step.latent, ...step.scopeAfter].map((n) => Number(supportOf(n.id).size));
      if (sizes.every((s) => Number.isFinite(s))) {
        const cost = sizes.reduce((a, b) => a * b, 1);
        if (cost > FRONTIER_COST_WARN) {
          issues.push(
            `eliminating '${step.latent.name}' enumerates ${cost} configurations; consider restructuring the model`
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
    issues
  };
}
function validateLatent(entry, factors, ctx, scopes, isSupported, byId, candidateIds, canTranslate) {
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
  if (factors.length === 0 && !entry.partial) {
    return `'${latent.name}' has no factors reading it; marginalizing it would be a no-op`;
  }
  const isScalarSupported = (id) => isSupported(id) && byId.get(id)?.tier === "scalar-dag";
  for (const f2 of factors) {
    if (f2.censorLower || f2.censorUpper || f2.equation?.trim()) {
      return `factor '${f2.name}' of '${latent.name}' has censoring or a data transform`;
    }
    const dist = f2.distribution ?? "";
    if (dist === "" || dist === "dflat" || !canTranslate(dist)) {
      return `factor '${f2.name}' of '${latent.name}' has no translatable distribution`;
    }
    if (dist === "dmulti") {
      return `factor '${f2.name}' of '${latent.name}' is multinomial, which the marginalizer does not handle`;
    }
    if (f2.nodeType === "stochastic" && DISCRETE_DISTRIBUTIONS.has(dist)) {
      const ok = entry.tier === "scalar-dag" && isScalarSupported(f2.id);
      if (!ok) {
        return `factor '${f2.name}' of '${latent.name}' is itself a discrete latent Stan cannot sample`;
      }
    }
  }
  const latentOnly = /* @__PURE__ */ new Set([latent.id]);
  const enRoute = new Set(
    [...factors, latent].flatMap((f2) => detsEnRoute(f2, ctx, latentOnly)).map((d) => d.id)
  );
  for (const det of ctx.nodes) {
    if (det.nodeType !== "deterministic") continue;
    if (discreteScope(det, ctx, latentOnly).size > 0 && !enRoute.has(det.id)) {
      return `deterministic node '${det.name}' reads '${latent.name}' but feeds no factor`;
    }
  }
  const inlineDets = dedupe([...factors, latent].flatMap((f2) => detsEnRoute(f2, ctx, candidateIds)));
  const scannedExprs = [...factors, ...inlineDets].flatMap(nodeExprs);
  if (entry.tier === "iid-plate") {
    const plates = platesOf(latent, ctx);
    const innermost = plates[plates.length - 1];
    const indexList = plateIndexList(plates);
    const ranges = plates.map((p) => (p.loopRange || "1:N").trim());
    if (ranges.some((r) => !r.startsWith("1:")) || normalizeIndices(latent.indices) !== indexList) {
      return `'${latent.name}' is in a plate structure the marginalizer does not handle`;
    }
    for (const f2 of factors) {
      if (plateOf(f2, ctx)?.id !== innermost.id) {
        return `factor '${f2.name}' reads '${latent.name}' from outside its plate`;
      }
      if (candidateIds.has(f2.id)) {
        return `factor '${f2.name}' of '${latent.name}' is itself a marginalization candidate`;
      }
      const others = [...scopes.get(f2.id) ?? []].filter((id) => id !== latent.id);
      if (others.length > 0) {
        return `factor '${f2.name}' reads '${latent.name}' and another discrete latent`;
      }
    }
    if (!referencesAreSubstitutable(scannedExprs, latent.name, indexList)) {
      return `'${latent.name}' is referenced in a form other than ${latent.name}[${indexList}]`;
    }
    const priorScope = scopes.get(latent.id) ?? /* @__PURE__ */ new Set();
    if (priorScope.size > 0) {
      return `the prior of '${latent.name}' depends on another discrete latent`;
    }
    return null;
  }
  if ((latent.indices || "").trim() !== "") {
    return `scalar latent '${latent.name}' has array indices`;
  }
  for (const f2 of factors) {
    if (plateOf(f2, ctx) !== void 0) {
      return `factor '${f2.name}' of scalar latent '${latent.name}' is inside a plate`;
    }
    for (const id of scopes.get(f2.id) ?? []) {
      if (!isScalarSupported(id)) {
        return `factor '${f2.name}' also reads a discrete latent the marginalizer cannot handle`;
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
function dedupe(nodes) {
  const seen = /* @__PURE__ */ new Set();
  return nodes.filter((n) => {
    if (seen.has(n.id)) return false;
    seen.add(n.id);
    return true;
  });
}

// ../../packages/doodleppl/src/codegen/stan.ts
var DISTRIBUTION_MAP = {
  dnorm: {
    stanName: "normal",
    stanParamNames: ["mu", "sigma"],
    transformParams: (params) => {
      const [mu, tau] = params;
      return [mu || "0", tau ? `1.0 / sqrt(${tau})` : "1"];
    }
  },
  dgamma: {
    stanName: "gamma",
    stanParamNames: ["alpha", "beta"],
    transformParams: (params) => [params[0] || "0.001", params[1] || "0.001"]
  },
  dbeta: {
    stanName: "beta",
    stanParamNames: ["alpha", "beta"],
    transformParams: (params) => [params[0] || "1", params[1] || "1"]
  },
  dbern: {
    stanName: "bernoulli",
    stanParamNames: ["theta"],
    transformParams: (params) => [params[0] || "0.5"]
  },
  dbin: {
    stanName: "binomial",
    stanParamNames: ["N", "theta"],
    transformParams: (params) => {
      const [prob, size] = params;
      return [size || "1", prob || "0.5"];
    }
  },
  dpois: {
    stanName: "poisson",
    stanParamNames: ["lambda"],
    transformParams: (params) => [params[0] || "1"]
  },
  dexp: {
    stanName: "exponential",
    stanParamNames: ["lambda"],
    transformParams: (params) => [params[0] || "1"]
  },
  dt: {
    stanName: "student_t",
    stanParamNames: ["nu", "mu", "sigma"],
    transformParams: (params) => {
      const [mu, tau, k] = params;
      return [k || "1", mu || "0", tau ? `1.0 / sqrt(${tau})` : "1"];
    }
  },
  dunif: {
    stanName: "uniform",
    stanParamNames: ["alpha", "beta"],
    transformParams: (params) => [params[0] || "0", params[1] || "1"]
  },
  dcat: {
    stanName: "categorical",
    stanParamNames: ["theta"],
    transformParams: (params) => [params[0] || ""]
  },
  dmnorm: {
    stanName: "multi_normal_prec",
    stanParamNames: ["mu", "Omega"],
    transformParams: (params) => [params[0] || "mu", params[1] || "Omega"]
  },
  // BUGS dmt(mu, Omega, k): Omega is precision matrix, k is degrees of freedom.
  // Stan multi_student_t(nu, mu, Sigma): Sigma is scale/covariance matrix = inverse(Omega).
  dmt: {
    stanName: "multi_student_t",
    stanParamNames: ["nu", "mu", "Sigma"],
    transformParams: (params) => {
      const [mu, Omega, k] = params;
      return [k || "1", mu || "mu", Omega ? `inverse(${Omega})` : "Sigma"];
    }
  },
  dwish: {
    stanName: "wishart",
    stanParamNames: ["nu", "S"],
    transformParams: (params) => {
      const [R2, k] = params;
      return [k || "1", R2 ? `inverse(${R2})` : "S"];
    }
  },
  ddirich: {
    stanName: "dirichlet",
    stanParamNames: ["alpha"],
    transformParams: (params) => [params[0] || "alpha"]
  },
  // BUGS dmulti(p, N): N (total count) is dropped because Stan's multinomial(theta)
  // only takes the probability simplex — N is implicit as sum(y) from the observed data.
  dmulti: {
    stanName: "multinomial",
    stanParamNames: ["theta"],
    transformParams: (params) => [params[0] || "theta"]
  },
  dlnorm: {
    stanName: "lognormal",
    stanParamNames: ["mu", "sigma"],
    transformParams: (params) => {
      const [mu, tau] = params;
      return [mu || "0", tau ? `1.0 / sqrt(${tau})` : "1"];
    }
  },
  dweib: {
    stanName: "weibull",
    stanParamNames: ["alpha", "sigma"],
    transformParams: (params) => {
      const [v, lambda] = params;
      const shape2 = v || "1";
      if (!lambda) return [shape2, "1"];
      return [shape2, `1.0 / (${lambda})`];
    }
  },
  dchisqr: {
    stanName: "chi_square",
    stanParamNames: ["nu"],
    transformParams: (params) => [params[0] || "1"]
  },
  dnegbin: {
    stanName: "neg_binomial",
    stanParamNames: ["alpha", "beta"],
    transformParams: (params) => {
      const [p, r] = params;
      return [r || "1", p ? `${p} / (1.0 - ${p})` : "1"];
    }
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
    }
  },
  // BUGS ddexp(mu, tau): tau is precision-like (variance is 1/tau), scale b = 1/sqrt(tau).
  // Stan double_exponential(mu, sigma): sigma = scale = 1/sqrt(tau).
  ddexp: {
    stanName: "double_exponential",
    stanParamNames: ["mu", "sigma"],
    transformParams: (params) => {
      const [mu, tau] = params;
      return [mu || "0", tau ? `1.0 / sqrt(${tau})` : "1"];
    }
  },
  // BUGS dlogis(mu, tau): tau is precision-like (variance is 1/tau), scale s = 1/sqrt(tau).
  // Stan logistic(mu, sigma): sigma = scale = 1/sqrt(tau).
  dlogis: {
    stanName: "logistic",
    stanParamNames: ["mu", "s"],
    transformParams: (params) => {
      const [mu, tau] = params;
      return [mu || "0", tau ? `1.0 / sqrt(${tau})` : "1"];
    }
  }
};
var INT_PARAM_POSITIONS = {
  dbin: /* @__PURE__ */ new Set([1]),
  dnegbin: /* @__PURE__ */ new Set([1]),
  dhyper: /* @__PURE__ */ new Set([0, 1, 2])
};
var PARAM_KEYS = ["param1", "param2", "param3"];
function findArrayIndexVarNames(nodes, plates) {
  const loopVars = /* @__PURE__ */ new Set();
  for (const p of plates) loopVars.add(p.loopVariable || "i");
  const indexVarNames = /* @__PURE__ */ new Set();
  for (const node of nodes) {
    if (node.nodeType === "plate") continue;
    for (const val of [
      node.equation,
      node.param1,
      node.param2,
      node.param3,
      node.censorLower,
      node.censorUpper
    ]) {
      if (!val) continue;
      const expr2 = String(val);
      let i = 0;
      while (i < expr2.length) {
        if (expr2[i] === "[") {
          const start = i + 1;
          let j = start;
          while (j < expr2.length && /[A-Za-z0-9_.]/.test(expr2[j])) j++;
          if (j > start) {
            const name = expr2.substring(start, j);
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
function findIntegerConstants(nodes) {
  const intConstants = /* @__PURE__ */ new Set();
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
function convertBugsName(name) {
  return name.replace(/\./g, "_");
}
function convertExpression(expr2) {
  let result = expr2.replace(/([a-zA-Z_][a-zA-Z0-9_]*)\.([a-zA-Z0-9_])/g, "$1_$2");
  result = result.replace(/\bloggam\b/g, "lgamma");
  result = result.replace(/\blogfact\s*\(([^)]+)\)/g, "lgamma($1 + 1)");
  result = result.replace(/\bilogit\b/g, "inv_logit");
  result = result.replace(/\bphi\s*\(/g, "Phi(");
  result = result.replace(/\bprobit\s*\(/g, "inv_Phi(");
  result = result.replace(/\bcloglog\s*\(([^)]+)\)/g, "log(-log(1 - $1))");
  result = result.replace(/\bicloglog\s*\(([^)]+)\)/g, "1 - exp(-exp($1))");
  result = result.replace(/\bcexpexp\s*\(([^)]+)\)/g, "1 - exp(-exp($1))");
  result = result.replace(/\binprod\b/g, "dot_product");
  result = result.replace(/\bstep\s*\(([^)]+)\)/g, "($1 >= 0 ? 1 : 0)");
  result = result.replace(/\b_step\s*\(([^)]+)\)/g, "($1 >= 0 ? 1 : 0)");
  result = result.replace(/\bequals\(([^,]+),\s*([^)]+)\)/g, "($1 == $2 ? 1 : 0)");
  result = result.replace(/\blogdet\b/g, "log_determinant");
  result = result.replace(/\bmexp\b/g, "matrix_exp");
  result = result.replace(/\bsoftplus\b/g, "log1p_exp");
  result = result.replace(/\blogistic\b(?!_)/g, "inv_logit");
  return result;
}
function classifyDeterministicBlocks(deterministicNodes, constantNodes, observedNodes, stochasticParams, edges, nodeMap) {
  const dataNodeIds = /* @__PURE__ */ new Set();
  for (const n of constantNodes) dataNodeIds.add(n.id);
  for (const n of observedNodes) dataNodeIds.add(n.id);
  const inEdges = /* @__PURE__ */ new Map();
  for (const e of edges) {
    const list = inEdges.get(e.target);
    if (list) list.push(e.source);
    else inEdges.set(e.target, [e.source]);
  }
  const isDataOnly = /* @__PURE__ */ new Map();
  function checkDataOnly(nodeId) {
    const cached = isDataOnly.get(nodeId);
    if (cached !== void 0) return cached;
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
  const reachesModel = /* @__PURE__ */ new Set();
  const modelNodeIds = /* @__PURE__ */ new Set();
  for (const n of stochasticParams) modelNodeIds.add(n.id);
  for (const n of observedNodes) modelNodeIds.add(n.id);
  function markReachesModel(nodeId) {
    if (reachesModel.has(nodeId)) return;
    reachesModel.add(nodeId);
    for (const pid of inEdges.get(nodeId) || []) markReachesModel(pid);
  }
  for (const mid of modelNodeIds) markReachesModel(mid);
  const transformedData = [];
  const transformedParams = [];
  const generatedQuantities = [];
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
function detectPartialPlateParams(elements) {
  const nodes = elements.filter((el) => el.type === "node");
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const result = [];
  for (const node of nodes) {
    if (node.nodeType !== "stochastic" || !node.parent) continue;
    const parentPlate = nodeMap.get(node.parent);
    if (parentPlate?.nodeType !== "plate") continue;
    const range = convertBugsName(parentPlate.loopRange || "1:N");
    const parts = range.split(":");
    if (parts.length !== 2) continue;
    const lower = Number.parseInt(parts[0], 10);
    const upper = Number.parseInt(parts[1], 10);
    if (Number.isNaN(lower) || Number.isNaN(upper) || lower <= 1) continue;
    result.push({
      stanName: convertBugsName(node.name),
      fullSize: upper,
      plateStart: lower,
      freeSize: upper - lower + 1
    });
  }
  return result;
}
function classifyNodes(nodes) {
  const stochasticParams = [];
  const deterministicNodes = [];
  const observedNodes = [];
  const constantNodes = [];
  const plates = [];
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
function getPlateAncestors(node, nodeMap) {
  const ancestors = [];
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
function getLoopDimensions(node, nodeMap) {
  const plates = getPlateAncestors(node, nodeMap);
  return plates.map((p) => ({
    variable: p.loopVariable || "i",
    range: convertBugsName(p.loopRange || "1:N")
  }));
}
function getArrayDimsFromNode(node, nodeMap, allPlates) {
  const indices = node.indices?.trim();
  if (indices) {
    const varToUpper = /* @__PURE__ */ new Map();
    for (const plate of allPlates) {
      const loopVar = plate.loopVariable || "i";
      const range = convertBugsName(plate.loopRange || "1:N");
      const parts = range.split(":");
      const upper = parts.length === 2 ? parts[1].trim() : range;
      varToUpper.set(loopVar, upper);
    }
    const indexParts = indices.split(",").map((s) => s.trim());
    const dims = [];
    for (const idx of indexParts) {
      const upper = varToUpper.get(idx);
      if (upper) {
        dims.push(upper);
      } else if (!/^\d+$/.test(idx)) {
        dims.push(idx);
      }
    }
    return dims;
  }
  const plateDims = getLoopDimensions(node, nodeMap);
  return plateDims.map((d) => {
    const parts = d.range.split(":");
    return parts.length === 2 ? parts[1] : d.range;
  });
}
function inferMultivariateDim(node) {
  const param1 = node.param1 ? String(node.param1).trim() : "";
  const dimMatch = param1.match(/\[1:(\w+)\]/) || param1.match(/\[(\d+)\]/);
  if (dimMatch) return dimMatch[1];
  return "K";
}
function inferStanType(node, nodeMap, allPlates) {
  const dims = getArrayDimsFromNode(node, nodeMap, allPlates);
  const dist = node.distribution;
  let baseType = "real";
  if (dist === "dbern" || dist === "dbin" || dist === "dpois" || dist === "dcat" || dist === "dnegbin" || dist === "dgeom" || dist === "dhyper" || dist === "dbetabin") {
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
function formatStanDistribution(node, nameToNode) {
  const dist = node.distribution;
  if (!dist || dist === "dflat") return null;
  const mapping = DISTRIBUTION_MAP[dist];
  if (!mapping) {
    return { error: `'${dist}' has no Stan equivalent \u2014 sampling statement omitted` };
  }
  const rawParams = collectRawParams(node, nameToNode);
  const transformed = mapping.transformParams(rawParams, node);
  return { stanDist: mapping.stanName, stanParams: transformed.join(", ") };
}
function collectRawParams(node, nameToNode) {
  return PARAM_KEYS.map((key) => {
    const val = node[key];
    const s = val ? String(val).trim() : "";
    return s ? formatStanParam(s, nameToNode) : "";
  });
}
function formatStanParam(raw, nameToNode) {
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
function needsBoundsFromDistribution(dist, node, nameToNode) {
  if (!dist) return "";
  switch (dist) {
    case "dgamma":
    case "dexp":
    case "dchisqr":
    case "dweib":
    case "dlnorm":
      return "<lower=0>";
    case "dpar": {
      const rawParams = collectRawParams(node, nameToNode);
      const c = rawParams[1] ? rawParams[1].replace(/\[.*$/, "") : "";
      return c ? `<lower=${c}>` : "<lower=0>";
    }
    case "dbeta":
      return "<lower=0, upper=1>";
    case "dunif": {
      const rawParams = collectRawParams(node, nameToNode);
      const lower = (rawParams[0] || "0").replace(/\[.*$/, "") || "0";
      const upper = (rawParams[1] || "1").replace(/\[.*$/, "") || "1";
      return `<lower=${lower}, upper=${upper}>`;
    }
    default:
      return "";
  }
}
function findUndeclaredDataVars(nodes, plateSizeVars) {
  const knownBugsNames = /* @__PURE__ */ new Set();
  const loopVars = /* @__PURE__ */ new Set();
  const loopVarToUpper = /* @__PURE__ */ new Map();
  for (const n of nodes) {
    if (n.nodeType === "plate") {
      const lv = n.loopVariable || "i";
      loopVars.add(lv);
      const range = convertBugsName(n.loopRange || "1:N");
      const parts = range.split(":");
      const upper = parts.length === 2 ? parts[1].trim() : range;
      loopVarToUpper.set(lv, upper);
    } else {
      knownBugsNames.add(n.name);
    }
  }
  const allExprs = [];
  for (const n of nodes) {
    if (n.nodeType === "plate") continue;
    for (const val of [n.equation, n.param1, n.param2, n.param3, n.censorLower, n.censorUpper]) {
      if (val) allExprs.push(String(val));
    }
  }
  const IDENT_RE2 = /(?<![0-9.])([A-Za-z_][A-Za-z0-9_.]*)(\s*)(\[([^\]]*)\])?/g;
  const undeclared = /* @__PURE__ */ new Map();
  for (const expr2 of allExprs) {
    IDENT_RE2.lastIndex = 0;
    let match = IDENT_RE2.exec(expr2);
    while (match !== null) {
      const bugsName = match[1];
      const subscript = match[4]?.trim();
      const charAfterIdent = expr2.charAt(match.index + bugsName.length);
      const skip = (
        // Skip function calls (identifier immediately followed by '(')
        charAfterIdent === "(" || // Skip loop variable bare names
        loopVars.has(bugsName) || // Skip known graph node names (dotted, as-is from JSON)
        knownBugsNames.has(bugsName) || // Skip numeric tokens
        /^\d/.test(bugsName)
      );
      if (!skip) {
        const stanName = convertBugsName(bugsName);
        if (!plateSizeVars.has(stanName) && !loopVars.has(stanName)) {
          let dimsSet = undeclared.get(stanName);
          if (!dimsSet) {
            dimsSet = /* @__PURE__ */ new Set();
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
      match = IDENT_RE2.exec(expr2);
    }
  }
  return [...undeclared.entries()].map(([stanName, dimsSet]) => ({
    stanName,
    dims: [...dimsSet]
  }));
}
var NON_VECTORIZABLE_DISTS = /* @__PURE__ */ new Set(["dmnorm", "dmt", "dwish", "ddirich", "dmulti"]);
var ANALYZE_OPTS = {
  canTranslate: (dist) => DISTRIBUTION_MAP[dist] !== void 0
};
var PARTIALIZABLE_DISTS = /* @__PURE__ */ new Set(["dcat", "dbern", "dbin"]);
function partialDiscreteNodes(elements, data) {
  if (!data) return [];
  return elements.filter((el) => {
    if (el.type !== "node" || el.nodeType !== "observed") return false;
    if (!el.distribution || !PARTIALIZABLE_DISTS.has(el.distribution)) return false;
    const values = data[el.name];
    return Array.isArray(values) && values.some((v) => v === null || v === void 0);
  });
}
function stripLoopVarFromParam(raw, plateVar, nameToNode) {
  const p = raw.trim();
  if (/^[+-]?(?:\d+\.?\d*|\d*\.\d+)(?:[eE][+-]?\d+)?$/.test(p)) return p;
  const singleIdxRe = /^([A-Za-z_][A-Za-z0-9_.]*)\[([^\]]+)\]$/;
  const m = singleIdxRe.exec(p);
  if (m) {
    const idx = m[2].trim();
    if (idx === plateVar) return convertBugsName(m[1]);
    return null;
  }
  const bareVarRe = new RegExp(`\\b${plateVar}\\b`);
  if (bareVarRe.test(p)) return null;
  if (/[()/*+-]/.test(p)) return convertExpression(p);
  if (/^[A-Za-z_][A-Za-z0-9_.]*$/.test(p)) {
    const ref = nameToNode.get(p);
    if (ref?.indices) {
      const refParts = ref.indices.split(",").map((s) => s.trim());
      if (refParts.length > 1) return null;
    }
    return convertBugsName(p);
  }
  return null;
}
function tryVectorizeNode(node, plateVar, indent, nameToNode) {
  if (node.censorLower || node.censorUpper) return null;
  if (node.equation) return null;
  const dist = node.distribution;
  if (!dist || NON_VECTORIZABLE_DISTS.has(dist)) return null;
  if (node.nodeType === "stochastic" && DISCRETE_DISTRIBUTIONS.has(dist)) return null;
  const idxParts = (node.indices || "").trim() ? (node.indices || "").split(",").map((s) => s.trim()) : [];
  if (idxParts.length !== 1 || idxParts[0] !== plateVar) return null;
  const stanName = convertBugsName(node.name);
  const rawParams = PARAM_KEYS.map((k) => {
    const val = node[k];
    return val ? String(val).trim() : "";
  });
  const strippedParams = [];
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
  const stanParams = mapping ? mapping.transformParams(strippedParams, node).join(", ") : strippedParams.join(", ");
  return `${indent}${stanName} ~ ${stanDist}(${stanParams});`;
}
var MATRIX_RESULT_FUNCTIONS = /\b(inverse|matrix_exp|crossprod|tcrossprod|diag_matrix|rep_matrix|append_col|append_row|cholesky_decompose|quad_form|mdivide_left|mdivide_right)\s*\(/;
var MULTIVARIATE_DISTS = /* @__PURE__ */ new Set(["dmnorm", "dmt", "dwish", "ddirich", "dmulti"]);
function nodeEquationHasMatrixResult(node, nameToNode) {
  const eq = node.equation ? String(node.equation) : "";
  if (MATRIX_RESULT_FUNCTIONS.test(eq)) return true;
  const identRe = /[A-Za-z_][A-Za-z0-9_.]*/g;
  let m = identRe.exec(eq);
  while (m !== null) {
    const ref = nameToNode.get(m[0]);
    if (ref?.distribution && MULTIVARIATE_DISTS.has(ref.distribution)) return true;
    m = identRe.exec(eq);
  }
  return false;
}
function escapeRe2(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function densityTerm(node, nameToNode, target) {
  const info = formatStanDistribution(node, nameToNode);
  if (info === null || "error" in info) return null;
  const dist = node.distribution ?? "";
  const suffix = DISCRETE_DISTRIBUTIONS.has(dist) || dist === "dmulti" ? "lpmf" : "lpdf";
  const lhs = target ?? `${convertBugsName(node.name)}${node.indices ? `[${node.indices}]` : ""}`;
  return `${info.stanDist}_${suffix}(${lhs} | ${info.stanParams})`;
}
function inlineDetRefs(term, dets, depth = 0) {
  if (depth > 8 || dets.length === 0) return term;
  let out = term;
  for (const d of dets) {
    const eq = `(${convertExpression(String(d.equation ?? ""))})`;
    const name = escapeRe2(convertBugsName(d.name));
    const idx = d.indices?.trim();
    const re2 = idx ? new RegExp(`(?<![A-Za-z0-9_])${name}\\s*\\[\\s*${escapeRe2(idx)}\\s*\\]`, "g") : new RegExp(`(?<![A-Za-z0-9_])${name}(?![A-Za-z0-9_])`, "g");
    out = out.replace(re2, eq);
  }
  return out === term ? out : inlineDetRefs(out, dets, depth + 1);
}
function substLatentRef(term, latentName, indexList, valExpr) {
  const name = escapeRe2(latentName);
  const subscript = indexList?.split(",").map((i) => `\\s*${escapeRe2(i.trim())}\\s*`).join(",");
  const re2 = subscript ? new RegExp(`(?<![A-Za-z0-9_])${name}\\s*\\[${subscript}\\]`, "g") : new RegExp(`(?<![A-Za-z0-9_])${name}(?![A-Za-z0-9_])`, "g");
  return term.replace(re2, valExpr);
}
function plateIndices(plan) {
  return plan.plates.map((p) => p.loopVariable || "i").join(",");
}
function latentLoopVars(latent, support) {
  const stanName = convertBugsName(latent.name);
  if (support.lo === 1) {
    const v = `${stanName}_val`;
    return { posVar: v, valExpr: v, valDecl: null };
  }
  const pos = `${stanName}_idx`;
  const val = `${stanName}_val`;
  const shift = support.lo - 1;
  const offset = shift >= 0 ? `+ ${shift}` : `- ${-shift}`;
  return { posVar: pos, valExpr: val, valDecl: `int ${val} = ${pos} ${offset};` };
}
function plateUpper(plate) {
  const range = convertBugsName(plate.loopRange || "1:N");
  const parts = range.split(":");
  return parts.length === 2 ? parts[1].trim() : range;
}
function plateTerms(plan, nameToNode, valOverride) {
  const indexList = plateIndices(plan);
  const valExpr = valOverride ?? latentLoopVars(plan.latent, plan.support).valExpr;
  const terms = [];
  const prior = densityTerm(plan.latent, nameToNode, valExpr);
  if (prior) terms.push(prior);
  for (const f2 of plan.factors) {
    const raw = densityTerm(f2, nameToNode);
    if (!raw) continue;
    const inlined = inlineDetRefs(raw, plan.inlineDets);
    terms.push(substLatentRef(inlined, plan.latent.name, indexList, valExpr));
  }
  return terms;
}
function sumLines(lhs, terms, indent) {
  return sumStatement(`${lhs} =`, terms, indent);
}
function sumStatement(head2, terms, indent) {
  const [first, ...rest] = terms;
  const lines = [`${indent}${head2} ${first ?? "0"}${rest.length === 0 ? ";" : ""}`];
  rest.forEach((t, i) => {
    lines.push(`${indent}  + ${t}${i === rest.length - 1 ? ";" : ""}`);
  });
  return lines;
}
function marginalizationBlock(plan, indent, nameToNode) {
  const stanName = convertBugsName(plan.latent.name);
  const { posVar, valDecl } = latentLoopVars(plan.latent, plan.support);
  const acc = `${stanName}_lp`;
  const terms = plateTerms(plan, nameToNode);
  const lines = [
    `${indent}{`,
    `${indent}  vector[${plan.support.size}] ${acc};`,
    `${indent}  for (${posVar} in 1:${plan.support.size}) {`
  ];
  if (valDecl) lines.push(`${indent}    ${valDecl}`);
  lines.push(...sumLines(`${acc}[${posVar}]`, terms, `${indent}    `));
  lines.push(`${indent}  }`, `${indent}  target += log_sum_exp(${acc});`, `${indent}}`);
  return lines;
}
function emitPlateMarginalization(plan, indent, nameToNode) {
  const stanName = convertBugsName(plan.latent.name);
  const idx = plateIndices(plan);
  if (!plan.partial) {
    return [
      `${indent}// marginalize out ${stanName}[${idx}]`,
      ...marginalizationBlock(plan, indent, nameToNode)
    ];
  }
  const obsTerms = plateTerms(plan, nameToNode, `${stanName}_obs[${idx}]`);
  return [
    `${indent}// marginalize out ${stanName}[${idx}] where it is missing`,
    `${indent}if (${stanName}_is_obs[${idx}] == 1) {`,
    ...sumStatement("target +=", obsTerms, `${indent}  `),
    `${indent}} else {`,
    ...marginalizationBlock(plan, `${indent}  `, nameToNode),
    `${indent}}`
  ];
}
function emitPlateRecovery(plan, nameToNode) {
  const stanName = convertBugsName(plan.latent.name);
  const idx = plateIndices(plan);
  const uppers = plan.plates.map(plateUpper);
  const { posVar, valDecl } = latentLoopVars(plan.latent, plan.support);
  const acc = `${stanName}_lp`;
  const terms = plateTerms(plan, nameToNode);
  const delta = plan.support.lo - 1;
  const shift = delta === 0 ? "" : delta > 0 ? ` + ${delta}` : ` - ${-delta}`;
  const base = "  ".repeat(plan.plates.length + 1);
  const inner = plan.partial ? `${base}  ` : base;
  const draw = [`${inner}vector[${plan.support.size}] ${acc};`];
  draw.push(`${inner}for (${posVar} in 1:${plan.support.size}) {`);
  if (valDecl) draw.push(`${inner}  ${valDecl}`);
  draw.push(...sumLines(`${acc}[${posVar}]`, terms, `${inner}  `));
  draw.push(`${inner}}`);
  draw.push(`${inner}${stanName}[${idx}] = categorical_rng(softmax(${acc}))${shift};`);
  const lines = [`  // recover ${stanName} from its conditional posterior`];
  plan.plates.forEach((plate, depth) => {
    lines.push(
      `${"  ".repeat(depth + 1)}for (${plate.loopVariable || "i"} in 1:${uppers[depth]}) {`
    );
  });
  if (plan.partial) {
    lines.push(
      `${base}if (${stanName}_is_obs[${idx}] == 1) {`,
      `${base}  ${stanName}[${idx}] = ${stanName}_obs[${idx}];`,
      `${base}} else {`,
      ...draw,
      `${base}}`
    );
  } else {
    lines.push(...draw);
  }
  for (let depth = plan.plates.length; depth > 0; depth--) {
    lines.push(`${"  ".repeat(depth)}}`);
  }
  return { decl: `  array[${uppers.join(", ")}] int ${stanName};`, lines };
}
function substOffsetRef(term, name, loopVar, offset, replacement) {
  const re2 = new RegExp(
    `(?<![A-Za-z0-9_])${escapeRe2(name)}\\s*\\[\\s*${escapeRe2(loopVar)}\\s*-\\s*${offset}\\s*\\]`,
    "g"
  );
  return term.replace(re2, replacement);
}
function substLoopVar(term, loopVar, timeExpr) {
  return term.replace(
    new RegExp(`(?<![A-Za-z0-9_])${escapeRe2(loopVar)}(?![A-Za-z0-9_])`, "g"),
    timeExpr
  );
}
function chainNames(plan) {
  const base = convertBugsName(plan.name);
  return {
    state: `${base}_val`,
    prev: `${base}_prev`,
    table: `${base}_lp`,
    next: `${base}_lp_next`,
    acc: `${base}_acc`
  };
}
function chainStateValue(plan, names) {
  const delta = plan.support.lo - 1;
  if (delta === 0) return names.state;
  return delta > 0 ? `(${names.state} + ${delta})` : `(${names.state} - ${-delta})`;
}
function chainEmissionTerms(plan, nameToNode, timeExpr, stateExpr, step) {
  const terms = [];
  for (const em of plan.emissions) {
    if (step === "init" ? em.from > plan.first : em.literalTime !== null) continue;
    const raw = densityTerm(em.node, nameToNode);
    if (!raw) continue;
    const withState = substLatentRef(
      raw,
      plan.name,
      em.literalTime !== null ? String(em.literalTime) : em.loopVar,
      stateExpr
    );
    terms.push(em.loopVar ? substLoopVar(withState, em.loopVar, timeExpr) : withState);
  }
  return terms;
}
function chainTransitionTerm(plan, nameToNode, timeExpr, prevExpr, targetExpr) {
  const raw = densityTerm(plan.transition, nameToNode, targetExpr);
  if (!raw) return null;
  const withPrev = substOffsetRef(raw, plan.name, plan.loopVar, 1, prevExpr);
  return substLoopVar(withPrev, plan.loopVar, timeExpr);
}
function emitChainMarginalization(plan, nameToNode) {
  const nm = chainNames(plan);
  const size = plan.support.size;
  const state = chainStateValue(plan, nm);
  const initPrior = densityTerm(plan.init, nameToNode, state);
  const lines = [
    `  // marginalize the chain ${convertBugsName(plan.name)} by a forward recursion`,
    "  {",
    `    vector[${size}] ${nm.table};`,
    `    vector[${size}] ${nm.next};`,
    `    vector[${size}] ${nm.acc};`,
    `    for (${nm.state} in 1:${size}) {`,
    ...sumLines(
      `${nm.table}[${nm.state}]`,
      [
        ...initPrior ? [initPrior] : [],
        ...chainEmissionTerms(plan, nameToNode, String(plan.first), state, "init")
      ],
      "      "
    ),
    "    }",
    `    for (${plan.loopVar} in ${plan.first + 1}:${plan.upper}) {`,
    `      for (${nm.state} in 1:${size}) {`,
    `        for (${nm.prev} in 1:${size}) {`
  ];
  const prevValue = chainStateValue(plan, { ...nm, state: nm.prev });
  const transition = chainTransitionTerm(plan, nameToNode, plan.loopVar, prevValue, state);
  lines.push(
    ...sumLines(
      `${nm.acc}[${nm.prev}]`,
      [`${nm.table}[${nm.prev}]`, ...transition ? [transition] : []],
      "          "
    ),
    "        }",
    ...sumLines(
      `${nm.next}[${nm.state}]`,
      [
        `log_sum_exp(${nm.acc})`,
        ...chainEmissionTerms(plan, nameToNode, plan.loopVar, state, "loop")
      ],
      "        "
    ),
    "      }",
    `      ${nm.table} = ${nm.next};`,
    "    }",
    `    target += log_sum_exp(${nm.table});`,
    "  }"
  );
  return lines;
}
function emitChainRecovery(plan, nameToNode) {
  const nm = chainNames(plan);
  const base = convertBugsName(plan.name);
  const size = plan.support.size;
  const state = chainStateValue(plan, nm);
  const prevValue = chainStateValue(plan, { ...nm, state: nm.prev });
  const initPrior = densityTerm(plan.init, nameToNode, state);
  const delta = plan.support.lo - 1;
  const shift = delta === 0 ? "" : delta > 0 ? ` + ${delta}` : ` - ${-delta}`;
  const fwd = `${base}_fwd`;
  const back = `${base}_rev`;
  const at2 = `${base}_at`;
  const lines = [
    `  // recover ${base} by forward filtering and backward sampling`,
    "  {",
    `    array[${plan.upper}] vector[${size}] ${fwd};`,
    `    vector[${size}] ${nm.acc};`,
    `    for (${nm.state} in 1:${size}) {`,
    ...sumLines(
      `${fwd}[${plan.first}][${nm.state}]`,
      [
        ...initPrior ? [initPrior] : [],
        ...chainEmissionTerms(plan, nameToNode, String(plan.first), state, "init")
      ],
      "      "
    ),
    "    }",
    `    for (${plan.loopVar} in ${plan.first + 1}:${plan.upper}) {`,
    `      for (${nm.state} in 1:${size}) {`,
    `        for (${nm.prev} in 1:${size}) {`,
    ...sumLines(
      `${nm.acc}[${nm.prev}]`,
      [
        `${fwd}[${plan.loopVar} - 1][${nm.prev}]`,
        ...chainTransitionTerm(plan, nameToNode, plan.loopVar, prevValue, state) ? [chainTransitionTerm(plan, nameToNode, plan.loopVar, prevValue, state)] : []
      ],
      "          "
    ),
    "        }",
    ...sumLines(
      `${fwd}[${plan.loopVar}][${nm.state}]`,
      [
        `log_sum_exp(${nm.acc})`,
        ...chainEmissionTerms(plan, nameToNode, plan.loopVar, state, "loop")
      ],
      "        "
    ),
    "      }",
    "    }",
    `    ${base}[${plan.upper}] = categorical_rng(softmax(${fwd}[${plan.upper}]))${shift};`,
    `    for (${back} in 1:(${plan.upper} - ${plan.first})) {`,
    `      int ${at2} = ${plan.upper} - ${back};`,
    `      for (${nm.prev} in 1:${size}) {`,
    ...sumLines(
      `${nm.acc}[${nm.prev}]`,
      [
        `${fwd}[${at2}][${nm.prev}]`,
        ...chainTransitionTerm(plan, nameToNode, `(${at2} + 1)`, prevValue, `${base}[${at2} + 1]`) ? [
          chainTransitionTerm(
            plan,
            nameToNode,
            `(${at2} + 1)`,
            prevValue,
            `${base}[${at2} + 1]`
          )
        ] : []
      ],
      "        "
    ),
    "      }",
    `      ${base}[${at2}] = categorical_rng(softmax(${nm.acc}))${shift};`,
    "    }",
    "  }"
  ];
  return { decls: [`  array[${plan.upper}] int ${base};`], lines };
}
function scalarNaming(plan) {
  const vars = /* @__PURE__ */ new Map();
  const supports = /* @__PURE__ */ new Map();
  for (const step of plan.steps) {
    vars.set(step.latent.id, latentLoopVars(step.latent, step.support));
    supports.set(step.latent.id, step.support);
  }
  return { vars, supports, phiScopes: /* @__PURE__ */ new Map() };
}
function scalarBucketTerms(step, plan, naming, nameToNode) {
  const inScope = [step.latent, ...step.scopeAfter];
  const substAll = (raw) => {
    let out = inlineDetRefs(raw, plan.inlineDets);
    for (const l of inScope) {
      out = substLatentRef(out, l.name, null, naming.vars.get(l.id)?.valExpr ?? l.name);
    }
    return out;
  };
  const terms = [];
  for (const f2 of step.bucketFactors) {
    const raw = densityTerm(f2, nameToNode, naming.vars.get(f2.id)?.valExpr);
    if (raw) terms.push(substAll(raw));
  }
  for (const phi of step.bucketPhis) {
    const scope = naming.phiScopes.get(phi.id) ?? [];
    const idx = scope.map((l) => naming.vars.get(l.id)?.posVar ?? "1").join(", ");
    terms.push(`phi_${convertBugsName(phi.name)}[${idx}]`);
  }
  return terms;
}
function emitScalarElimination(plan, nameToNode) {
  const naming = scalarNaming(plan);
  const decls = [];
  const body = [];
  for (const step of plan.steps) {
    const stanName = convertBugsName(step.latent.name);
    const { posVar, valDecl } = naming.vars.get(step.latent.id);
    const acc = `${stanName}_lp`;
    const terms = scalarBucketTerms(step, plan, naming, nameToNode);
    body.push(`    // eliminate ${stanName}`);
    let indent = "    ";
    for (const outer of step.scopeAfter) {
      const ov = naming.vars.get(outer.id);
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
    "  }"
  ];
}
function emitScalarRecovery(plan, nameToNode) {
  const naming = scalarNaming(plan);
  const substAll = (raw) => {
    let out = inlineDetRefs(raw, plan.inlineDets);
    for (const l of plan.latents) {
      out = substLatentRef(out, l.name, null, naming.vars.get(l.id)?.valExpr ?? l.name);
    }
    return out;
  };
  const terms = [];
  for (const l of plan.latents) {
    const prior = densityTerm(l, nameToNode, naming.vars.get(l.id)?.valExpr);
    if (prior) terms.push(substAll(prior));
  }
  for (const f2 of plan.factors) {
    const raw = densityTerm(f2, nameToNode);
    if (raw) terms.push(substAll(raw));
  }
  const sizes = plan.latents.map((l) => naming.supports.get(l.id)?.size ?? "1");
  const numericSizes = sizes.map(Number);
  if (numericSizes.every(Number.isFinite)) {
    const cost = numericSizes.reduce((a, b) => a * b, 1);
    if (cost > FRONTIER_COST_WARN) {
      return {
        decls: [],
        lines: [`  // latent recovery skipped: joint enumeration of ${cost} configurations`]
      };
    }
  }
  const total = sizes.join(" * ");
  const decls = plan.latents.map((l) => `  int ${convertBugsName(l.name)};`);
  const lines = [
    "  // recover the scalar discrete latents from their joint conditional posterior",
    "  {",
    `    vector[${total}] marg_joint_lp;`,
    ...plan.latents.map((l) => `    array[${total}] int marg_conf_${convertBugsName(l.name)};`),
    "    int marg_c = 0;",
    "    int marg_pick;"
  ];
  let indent = "    ";
  for (const l of plan.latents) {
    const v = naming.vars.get(l.id);
    lines.push(`${indent}for (${v.posVar} in 1:${naming.supports.get(l.id)?.size ?? "1"}) {`);
    indent += "  ";
    if (v.valDecl) lines.push(`${indent}${v.valDecl}`);
  }
  lines.push(`${indent}marg_c += 1;`);
  lines.push(...sumLines("marg_joint_lp[marg_c]", terms, indent));
  for (const l of plan.latents) {
    const v = naming.vars.get(l.id);
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
function latentIndexedDataDims(analysis, loopVarToUpper) {
  const latentSize = /* @__PURE__ */ new Map();
  const exprNodes = [];
  for (const l of analysis.latents) {
    if (l.tier === "unsupported" || !l.support) continue;
    latentSize.set(l.node.name, l.support.size);
    exprNodes.push(l.node);
  }
  if (latentSize.size === 0) return /* @__PURE__ */ new Map();
  for (const plan of analysis.platePlans) exprNodes.push(...plan.factors, ...plan.inlineDets);
  if (analysis.scalarPlan) {
    exprNodes.push(...analysis.scalarPlan.factors, ...analysis.scalarPlan.inlineDets);
  }
  const resolveSub = (sub) => {
    const latent = [...latentSize.keys()].find(
      (n) => new RegExp(`(?<![A-Za-z0-9_])${escapeRe2(n)}(?![A-Za-z0-9_])`).test(sub)
    );
    if (latent) return latentSize.get(latent);
    const upper = loopVarToUpper.get(sub);
    if (upper) return upper;
    const range = sub.match(/^(\S+)\s*:\s*(\S+)$/);
    if (range) {
      if (range[1] === "1" || /^\d+$/.test(range[2])) return range[2];
      return "";
    }
    if (/^\d+$/.test(sub)) return sub;
    return "";
  };
  const dims = /* @__PURE__ */ new Map();
  const INDEXED_RE = /(?<![0-9.])([A-Za-z_][A-Za-z0-9_.]*)\s*\[([^\][]*(?:\[[^\]]*\][^\][]*)*)\]/g;
  for (const node of exprNodes) {
    for (const expr2 of [node.equation, node.param1, node.param2, node.param3]) {
      if (!expr2) continue;
      INDEXED_RE.lastIndex = 0;
      let m = INDEXED_RE.exec(String(expr2));
      while (m !== null) {
        const base = m[1];
        const subs = splitTopLevel(m[2]);
        const resolved = subs.map(resolveSub);
        const hasLatent = subs.some(
          (sub) => [...latentSize.keys()].some(
            (n) => new RegExp(`(?<![A-Za-z0-9_])${escapeRe2(n)}(?![A-Za-z0-9_])`).test(sub)
          )
        );
        if (hasLatent && resolved.every((d) => d !== "")) {
          dims.set(convertBugsName(base), resolved);
        }
        m = INDEXED_RE.exec(String(expr2));
      }
    }
  }
  return dims;
}
function splitTopLevel(subs) {
  const parts = [];
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
function catPriorVectorOverrides(analysis) {
  const latentSize = new Map(
    analysis.latents.filter((l) => l.tier !== "unsupported" && l.support).map((l) => [l.node.name, l.support.size])
  );
  const overrides = /* @__PURE__ */ new Map();
  for (const l of analysis.latents) {
    if (l.tier === "unsupported" || l.node.distribution !== "dcat" || !l.support) continue;
    const p1 = String(l.node.param1 ?? "").trim();
    const plain = p1.match(/^([A-Za-z_][A-Za-z0-9_.]*)\s*(?:\[\s*(?::|1\s*:\s*[^\]]+)?\s*\])?$/);
    if (plain) {
      overrides.set(convertBugsName(plain[1]), `vector[${l.support.size}]`);
      continue;
    }
    const slice = p1.match(/^([A-Za-z_][A-Za-z0-9_.]*)\s*\[\s*\d+\s*:\s*(\d+)\s*\]$/);
    if (slice) {
      overrides.set(convertBugsName(slice[1]), `vector[${slice[2]}]`);
      continue;
    }
    const rowIndexed = p1.match(
      /^([A-Za-z_][A-Za-z0-9_.]*)\s*\[\s*([A-Za-z_][A-Za-z0-9_]*)\s*,\s*1\s*:\s*([^\]]+?)\s*\]$/
    );
    if (rowIndexed) {
      const rowDim = latentSize.get(rowIndexed[2]);
      if (rowDim) {
        overrides.set(
          convertBugsName(rowIndexed[1]),
          `array[${rowDim}] vector[${rowIndexed[3]}]`
        );
      }
    }
  }
  for (const plan of analysis.chainPlans) {
    if (plan.transition.distribution !== "dcat") continue;
    const p1 = String(plan.transition.param1 ?? "").trim();
    const m = p1.match(
      new RegExp(
        `^([A-Za-z_][A-Za-z0-9_.]*)\\s*\\[\\s*${escapeRe2(plan.name)}\\s*\\[[^\\]]*\\]\\s*,\\s*1\\s*:\\s*([^\\]]+?)\\s*\\]$`
      )
    );
    if (m) {
      overrides.set(convertBugsName(m[1]), `array[${plan.support.size}] vector[${m[2]}]`);
    }
  }
  return overrides;
}
function generateStanModel(elements, data) {
  const nodes = elements.filter((el) => el.type === "node");
  const edges = elements.filter((el) => el.type === "edge");
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const nameToNode = new Map(nodes.map((n) => [n.name, n]));
  if (nodes.length === 0) {
    return "// Empty model\n";
  }
  const { stochasticParams, deterministicNodes, observedNodes, constantNodes, plates } = classifyNodes(nodes);
  const topoOrder = buildTopologicalOrder(nodes, edges);
  const topoIndex = new Map(topoOrder.map((id, i) => [id, i]));
  const partialIds = new Set(partialDiscreteNodes(elements, data).map((n) => n.id));
  const marg = analyzeDiscreteLatents(elements, topoOrder, { ...ANALYZE_OPTS, partialIds });
  const margLatentIds = new Set(
    marg.latents.filter((l) => l.tier !== "unsupported").map((l) => l.node.id)
  );
  const margReasons = new Map(
    marg.latents.filter((l) => l.tier === "unsupported" && l.reason).map((l) => [l.node.id, l.reason])
  );
  const platePlanByLatent = new Map(marg.platePlans.map((p) => [p.latent.id, p]));
  const consumedFactorIds = new Set(
    [...marg.consumedFactorIds].filter((id) => !margLatentIds.has(id))
  );
  const handledByMarginalization = (id) => !platePlanByLatent.has(id) && (consumedFactorIds.has(id) || margLatentIds.has(id));
  const plateUppers = /* @__PURE__ */ new Map();
  for (const n of nodes) {
    if (n.nodeType !== "plate") continue;
    const parts = convertBugsName(n.loopRange || "1:N").split(":");
    if (parts.length === 2) plateUppers.set(n.loopVariable || "i", parts[1].trim());
  }
  const latentDims = latentIndexedDataDims(marg, plateUppers);
  const sortByTopo = (a, b) => (topoIndex.get(a.id) ?? 0) - (topoIndex.get(b.id) ?? 0);
  const dataDeclarations = [];
  const parameterDeclarations = [];
  const transformedParamLines = [];
  const mvTypeOverrides = catPriorVectorOverrides(marg);
  const nonDataNodeStanNames = /* @__PURE__ */ new Set([
    ...stochasticParams.map((n) => convertBugsName(n.name)),
    ...deterministicNodes.map((n) => convertBugsName(n.name))
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
  const plateSizeVars = /* @__PURE__ */ new Set();
  for (const plate of plates) {
    const range = plate.loopRange || "";
    const converted = convertBugsName(range);
    const parts = converted.split(":");
    if (parts.length === 2) {
      const upper = parts[1].trim();
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
    const dims = ownDims.length > 0 ? ownDims : latentDims.get(stanName) ?? ownDims;
    const mvType = mvTypeOverrides.get(stanName);
    if (mvType) {
      if (dims.length > 0 && !mvType.startsWith("array[")) {
        dataDeclarations.push(`  array[${dims.join(", ")}] ${mvType} ${stanName};`);
      } else {
        dataDeclarations.push(`  ${mvType} ${stanName};`);
      }
    } else {
      const isInt = intConstantNames.has(node.name) || arrayIndexVarNames.has(node.name) || arrayIndexVarNames.has(stanName);
      const baseType = isInt ? "int" : "real";
      if (dims.length > 0) {
        dataDeclarations.push(`  array[${dims.join(", ")}] ${baseType} ${stanName};`);
      } else {
        dataDeclarations.push(`  ${baseType} ${stanName};`);
      }
    }
  }
  const partialPlans = new Map(
    marg.platePlans.filter((pl) => pl.partial).map((pl) => [pl.latent.id, pl])
  );
  for (const node of observedNodes.sort(sortByTopo)) {
    const stanName = convertBugsName(node.name);
    const partialPlan = partialPlans.get(node.id);
    if (partialPlan) {
      const dims = partialPlan.plates.map(plateUpper).join(", ");
      dataDeclarations.push(`  array[${dims}] int ${stanName}_obs;`);
      dataDeclarations.push(`  array[${dims}] int ${stanName}_is_obs;`);
      continue;
    }
    const stanType = inferStanType(node, nodeMap, plates);
    dataDeclarations.push(`  ${stanType} ${stanName};`);
    const cl = node.censorLower ? String(node.censorLower).trim() : "";
    const cu = node.censorUpper ? String(node.censorUpper).trim() : "";
    if (cl || cu) {
      const dims = getArrayDimsFromNode(node, nodeMap, plates);
      const boundNames = /* @__PURE__ */ new Set();
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
  const alreadyDeclared = new Set(
    dataDeclarations.map((d) => (d.trim().split(/\s+/).pop() ?? "").replace(";", ""))
  );
  for (const { stanName, dims: foundDims } of findUndeclaredDataVars(nodes, plateSizeVars)) {
    if (alreadyDeclared.has(stanName)) continue;
    const dims = foundDims.length > 0 ? foundDims : latentDims.get(stanName) ?? foundDims;
    const mvType = mvTypeOverrides.get(stanName);
    if (mvType) {
      if (dims.length > 0 && !mvType.startsWith("array[")) {
        dataDeclarations.push(`  array[${dims.join(", ")}] ${mvType} ${stanName};`);
      } else {
        dataDeclarations.push(`  ${mvType} ${stanName};`);
      }
    } else {
      const bugsName = stanName.replace(/_/g, ".");
      const isInt = intConstantNames.has(bugsName) || intConstantNames.has(stanName) || arrayIndexVarNames.has(bugsName) || arrayIndexVarNames.has(stanName);
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
  const partialPlateWarningNames = /* @__PURE__ */ new Set();
  for (const node of stochasticParams) {
    if (!node.parent) continue;
    const parentPlate = nodeMap.get(node.parent);
    if (parentPlate?.nodeType !== "plate") continue;
    const range = convertBugsName(parentPlate.loopRange || "1:N");
    const parts = range.split(":");
    if (parts.length !== 2) continue;
    const lower = Number.parseInt(parts[0], 10);
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
      for (let i = 1; i < ppInfo.plateStart; i++) {
        transformedParamLines.push(`  ${stanName}[${i}] = 0;  // placeholder: outside plate range`);
      }
      for (let i = ppInfo.plateStart; i <= ppInfo.fullSize; i++) {
        transformedParamLines.push(
          `  ${stanName}[${i}] = ${stanName}_free[${i - ppInfo.plateStart + 1}];`
        );
      }
      continue;
    }
    if (partialPlateWarningNames.has(stanName)) {
      const parentPlate = node.parent ? nodeMap.get(node.parent) : void 0;
      const range = parentPlate ? convertBugsName(parentPlate.loopRange || "1:N") : "?:N";
      parameterDeclarations.push(
        `  // WARNING: '${stanName}' is in a plate with range '${range}' (lower > 1, symbolic upper).`
      );
      parameterDeclarations.push(
        `  // Partial-plate handling requires a literal upper bound. Declare '${stanName}_free' manually.`
      );
    }
    const dist = node.distribution;
    let baseType = "real";
    const mvDim = inferMultivariateDim(node);
    const mvDistributions = /* @__PURE__ */ new Set(["dmnorm", "dmt", "dwish", "ddirich"]);
    const p1str = node.param1 ? String(node.param1).trim() : "";
    const mvDimExplicit = !!(p1str.match(/\[1:(\w+)\]/) || p1str.match(/\[(\d+)\]/));
    if (dist === "dmnorm" || dist === "dmt") baseType = `vector[${mvDim}]`;
    else if (dist === "dwish") baseType = `cov_matrix[${mvDim}]`;
    else if (dist === "ddirich") baseType = `simplex[${mvDim}]`;
    if (dist && mvDistributions.has(dist) && !mvDimExplicit) {
      parameterDeclarations.push(
        `  // TODO: Replace 'K' in the declaration below with the actual dimension (could not infer from param1).`
      );
    }
    if (dist === "dwish") {
      parameterDeclarations.push(
        `  // NOTE: '${stanName}' is declared as cov_matrix (symmetric positive-definite).`
      );
      parameterDeclarations.push(
        `  // In BUGS, dwish variables are typically used as precision matrices. If so, pass inverse(${stanName}) where a covariance matrix is expected.`
      );
    }
    if (dist && DISCRETE_DISTRIBUTIONS.has(dist)) {
      parameterDeclarations.push(`  // WARNING: ${stanName} ~ ${dist} is a discrete distribution.`);
      parameterDeclarations.push(
        `  // Stan cannot sample discrete latent parameters. Marginalize out ${stanName} or restructure the model.`
      );
      const reason = margReasons.get(node.id);
      if (reason) {
        parameterDeclarations.push(`  // (automatic marginalization not applied: ${reason})`);
      }
    }
    if (dims.length > 0) {
      if (baseType.startsWith("vector") || baseType.startsWith("cov_matrix") || baseType.startsWith("simplex")) {
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
    generatedQuantities: gqDetNodes
  } = classifyDeterministicBlocks(
    deterministicNodes.filter((n) => !marg.inlinedDetIds.has(n.id)),
    constantNodes,
    observedNodes,
    stochasticParams,
    edges,
    nodeMap
  );
  const transformedDataDeclLines = [];
  const transformedDataIds = new Set(transformedData.map((n) => n.id));
  const gqIds = new Set(gqDetNodes.map((n) => n.id));
  const intTransformedDataIds = /* @__PURE__ */ new Set();
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
  const gqDeclLines = [];
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
  const plateChildren = /* @__PURE__ */ new Map();
  const rootNodes = [];
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
  const generateBlockStatements = (nodesToProcess, indent, blockType, detFilter) => {
    const lines = [];
    const sorted = [...nodesToProcess].sort(sortByTopo);
    for (const node of sorted) {
      if (blockType === "model") {
        const platePlan = platePlanByLatent.get(node.id);
        if (platePlan) {
          lines.push(...emitPlateMarginalization(platePlan, indent, nameToNode));
          continue;
        }
        if (handledByMarginalization(node.id)) continue;
      }
      if (node.nodeType === "plate") {
        const plateVar = node.loopVariable || "i";
        const plateRange = convertBugsName(node.loopRange || "1:N");
        const rangeParts = plateRange.split(":");
        const lower = rangeParts[0] || "1";
        const upper = rangeParts.length === 2 ? rangeParts[1] : plateRange;
        const children = plateChildren.get(node.id) || [];
        const nestedPlates = plates.filter((p) => p.parent === node.id);
        if (blockType === "model") {
          const canVectorize = lower === "1";
          const plateNodes = children.filter(
            (c) => (c.nodeType === "stochastic" || c.nodeType === "observed") && !handledByMarginalization(c.id)
          ).sort(sortByTopo);
          const vectorizedLines = [];
          const loopNodes = [];
          for (const child of plateNodes) {
            const vLine = canVectorize && !platePlanByLatent.has(child.id) ? tryVectorizeNode(child, plateVar, indent, nameToNode) : null;
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
                detFilter
              )
            );
            lines.push(`${indent}}`);
          }
        } else {
          const plateNodes = children.filter(
            (c) => c.nodeType === "deterministic" && (!detFilter || detFilter.has(c.id))
          );
          const innerLines = generateBlockStatements(
            [...plateNodes, ...nestedPlates],
            `${indent}  `,
            blockType,
            detFilter
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
          let expr2 = convertExpression(node.equation);
          if (intTransformedDataIds.has(node.id)) {
            expr2 = `to_int(round(${expr2}))`;
          }
          lines.push(`${indent}${stanName}${idx} = ${expr2};`);
        }
      }
      if (blockType === "model" && (node.nodeType === "stochastic" || node.nodeType === "observed")) {
        const distInfo = formatStanDistribution(node, nameToNode);
        if (distInfo === null) {
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
              `${indent}  ${stanName}${idx} ~ ${distInfo.stanDist}(${distInfo.stanParams});`
            );
            lines.push(`${indent}} else {`);
            if (cl && cu) {
              lines.push(
                `${indent}  target += log_diff_exp(${distInfo.stanDist}_lcdf(${stanBoundU} | ${distInfo.stanParams}), ${distInfo.stanDist}_lcdf(${stanBoundL} | ${distInfo.stanParams}));`
              );
            } else if (cl) {
              lines.push(
                `${indent}  target += ${distInfo.stanDist}_lccdf(${stanBoundL} | ${distInfo.stanParams});`
              );
            } else {
              lines.push(
                `${indent}  target += ${distInfo.stanDist}_lcdf(${stanBoundU} | ${distInfo.stanParams});`
              );
            }
            lines.push(`${indent}}`);
          } else {
            if (node.nodeType === "stochastic" && node.distribution && DISCRETE_DISTRIBUTIONS.has(node.distribution)) {
              lines.push(
                `${indent}// WARNING: discrete latent variable \u2014 Stan requires marginalizing out ${stanName}.`
              );
            }
            if (node.equation && String(node.equation).trim()) {
              lines.push(
                `${indent}// WARNING: BUGS node '${stanName}' has an equation ('${convertExpression(String(node.equation).trim())}')`
              );
              lines.push(
                `${indent}// that was not translated. Embed this expression in the distribution parameters or use a deterministic node.`
              );
            }
            if (node.distribution === "dmulti") {
              lines.push(
                `${indent}// Note: BUGS dmulti total count N dropped \u2014 Stan's multinomial treats N = sum(y) implicitly.`
              );
            }
            lines.push(
              `${indent}${stanName}${idx} ~ ${distInfo.stanDist}(${distInfo.stanParams});`
            );
          }
        }
      }
    }
    return lines;
  };
  const rootDeterministic = rootNodes.filter((n) => n.nodeType === "deterministic");
  const rootStochastic = rootNodes.filter(
    (n) => n.nodeType === "stochastic" || n.nodeType === "observed"
  );
  const rootPlates = plates.filter((p) => !p.parent);
  const tdStatements = generateBlockStatements(
    [...rootDeterministic, ...rootPlates],
    "  ",
    "transformed",
    transformedDataIds
  );
  const tpNodeIds = new Set(tpDetNodes.map((n) => n.id));
  const tpStatements = generateBlockStatements(
    [...rootDeterministic, ...rootPlates],
    "  ",
    "transformed",
    tpNodeIds
  );
  const modelStatements = generateBlockStatements(
    [...rootStochastic, ...rootPlates],
    "  ",
    "model"
  );
  for (const plan of marg.chainPlans) {
    modelStatements.push(...emitChainMarginalization(plan, nameToNode));
  }
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
    gqIds
  );
  const recoveryDecls = [];
  const recoveryLines = [];
  for (const plan of marg.platePlans) {
    const { decl, lines } = emitPlateRecovery(plan, nameToNode);
    recoveryDecls.push(decl);
    recoveryLines.push(...lines);
  }
  for (const plan of marg.chainPlans) {
    const { decls, lines } = emitChainRecovery(plan, nameToNode);
    recoveryDecls.push(...decls);
    recoveryLines.push(...lines);
  }
  if (marg.scalarPlan) {
    const { decls, lines } = emitScalarRecovery(marg.scalarPlan, nameToNode);
    recoveryDecls.push(...decls);
    recoveryLines.push(...lines);
  }
  const sections = [];
  if (dataDeclarations.length > 0) {
    sections.push(`data {
${dataDeclarations.join("\n")}
}`);
  }
  if (tdStatements.length > 0) {
    const tdDeclBlock = transformedDataDeclLines.length > 0 ? `${transformedDataDeclLines.join("\n")}
` : "";
    sections.push(`transformed data {
${tdDeclBlock}${tdStatements.join("\n")}
}`);
  }
  if (parameterDeclarations.length > 0) {
    sections.push(`parameters {
${parameterDeclarations.join("\n")}
}`);
  }
  if (tpStatements.length > 0 || transformedParamLines.length > 0) {
    const tpDeclBlock = transformedParamLines.length > 0 ? `${transformedParamLines.join("\n")}
` : "";
    const tpBody = tpStatements.length > 0 ? tpStatements.join("\n") : "";
    const content = tpDeclBlock + tpBody;
    if (content.trim()) {
      sections.push(`transformed parameters {
${content}
}`);
    }
  }
  if (modelStatements.length > 0) {
    sections.push(`model {
${modelStatements.join("\n")}
}`);
  }
  if (gqStatements.length > 0 || recoveryLines.length > 0) {
    const decls = [...recoveryDecls, ...gqDeclLines];
    const gqDeclBlock = decls.length > 0 ? `${decls.join("\n")}
` : "";
    const body = [...recoveryLines, ...gqStatements].join("\n");
    sections.push(`generated quantities {
${gqDeclBlock}${body}
}`);
  }
  if (sections.length === 0) {
    return "// Empty model\n";
  }
  return `${sections.join("\n\n")}
`;
}
export {
  BugsSyntaxError,
  applyLayout,
  generateBugsModel,
  generateStanModel,
  graphFromStanAst,
  layoutGraph,
  parseBugs,
  renderGraphSvg
};
/*! Bundled license information:

@dagrejs/dagre/dist/dagre.esm.js:
  (*! For license information please see dagre.esm.js.LEGAL.txt *)
*/
