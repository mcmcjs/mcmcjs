// Recursive-descent parser for BUGS model programs. Produces a small AST that
// keeps the author's parentheses, so expressions print back the way they were
// written rather than re-derived from precedence.

import { BugsSyntaxError, type Token, tokenize } from "./lexer";

export type Expr =
  | { kind: "num"; text: string }
  | { kind: "var"; name: string; index?: IndexItem[] }
  | { kind: "call"; fn: string; args: Expr[] }
  | { kind: "unary"; op: string; arg: Expr }
  | { kind: "binary"; op: string; left: Expr; right: Expr }
  | { kind: "paren"; inner: Expr };

/** One subscript slot: an expression, a range, or empty (`x[i, ]` means all). */
export type IndexItem = { kind: "range"; lo: Expr | null; hi: Expr | null } | Expr | null;

export interface VarRef {
  name: string;
  index?: IndexItem[];
}

export interface Bound {
  /** `C`, `T`, or the legacy `I`. */
  form: "C" | "T" | "I";
  lower: Expr | null;
  upper: Expr | null;
}

export type Stmt =
  | { kind: "stochastic"; target: VarRef; dist: string; args: Expr[]; bound?: Bound; line: number }
  | { kind: "logical"; target: VarRef; link?: string; value: Expr; line: number }
  | { kind: "for"; variable: string; lo: Expr; hi: Expr; body: Stmt[]; line: number };

export interface Program {
  statements: Stmt[];
}

export function parseProgram(source: string): Program {
  return new Parser(tokenize(source)).program();
}

class Parser {
  private pos = 0;

  constructor(private readonly tokens: Token[]) {}

  program(): Program {
    if (this.isIdent("model")) this.pos++;
    const statements =
      this.peek().value === "{" ? this.block() : this.statements(() => this.peek().kind === "eof");
    if (this.peek().kind !== "eof") this.fail(`unexpected "${this.peek().value}" after the model`);
    return { statements };
  }

  private block(): Stmt[] {
    this.expectOp("{");
    const body = this.statements(() => this.peek().value === "}");
    this.expectOp("}");
    return body;
  }

  private statements(done: () => boolean): Stmt[] {
    const out: Stmt[] = [];
    while (!done()) {
      if (this.peek().kind === "eof") this.fail("unexpected end of program");
      if (this.acceptOp(";")) continue;
      out.push(this.statement());
    }
    return out;
  }

  private statement(): Stmt {
    const line = this.peek().line;
    if (this.isIdent("for")) return this.forLoop(line);

    const lhs = this.postfix();
    let target: VarRef;
    let link: string | undefined;
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

  private forLoop(line: number): Stmt {
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

  private bound(): Bound | undefined {
    const t = this.peek();
    if (t.kind !== "ident" || !["C", "T", "I"].includes(t.value)) return undefined;
    if (this.tokens[this.pos + 1]?.value !== "(") return undefined;
    this.pos += 2;
    const lower = this.peek().value === "," ? null : this.expression();
    this.expectOp(",");
    const upper = this.peek().value === ")" ? null : this.expression();
    this.expectOp(")");
    return { form: t.value as Bound["form"], lower, upper };
  }

  // Precedence climbing, lowest first.
  private expression(): Expr {
    return this.binary(0);
  }

  private static readonly LEVELS: string[][] = [
    ["||"],
    ["&&"],
    ["==", "!=", "<", ">", "<=", ">="],
    ["+", "-"],
    ["*", "/"],
  ];

  private binary(level: number): Expr {
    if (level >= Parser.LEVELS.length) return this.unary();
    let left = this.binary(level + 1);
    for (;;) {
      const t = this.peek();
      if (t.kind !== "op" || !(Parser.LEVELS[level] ?? []).includes(t.value)) return left;
      this.pos++;
      const right = this.binary(level + 1);
      left = { kind: "binary", op: t.value, left, right };
    }
  }

  private unary(): Expr {
    const t = this.peek();
    if (t.kind === "op" && (t.value === "-" || t.value === "+" || t.value === "!")) {
      this.pos++;
      return { kind: "unary", op: t.value, arg: this.unary() };
    }
    return this.power();
  }

  private power(): Expr {
    const base = this.postfix();
    if (this.acceptOp("^")) {
      // Right-associative, and a unary minus binds looser than ^ in BUGS.
      return { kind: "binary", op: "^", left: base, right: this.unary() };
    }
    return base;
  }

  private postfix(): Expr {
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
        const args: Expr[] = [];
        if (!this.acceptOp(")")) {
          do args.push(this.expression());
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

  private index(): IndexItem[] {
    this.expectOp("[");
    const items: IndexItem[] = [];
    for (;;) {
      const t = this.peek();
      if (t.value === "," || t.value === "]") {
        items.push(null);
      } else {
        const first = this.expression();
        if (this.acceptOp(":")) {
          const hi =
            this.peek().value === "," || this.peek().value === "]" ? null : this.expression();
          items.push({ kind: "range", lo: first, hi });
        } else {
          items.push(first);
        }
      }
      if (this.acceptOp("]")) return items;
      this.expectOp(",");
    }
  }

  private peek(): Token {
    // The token list always ends with `eof`, which the parser never consumes.
    return this.tokens[this.pos] ?? (this.tokens[this.tokens.length - 1] as Token);
  }

  private isIdent(name: string): boolean {
    const t = this.peek();
    return t.kind === "ident" && t.value === name;
  }

  private acceptOp(op: string): boolean {
    const t = this.peek();
    if (t.kind === "op" && t.value === op) {
      this.pos++;
      return true;
    }
    return false;
  }

  private expectOp(op: string): void {
    if (!this.acceptOp(op))
      this.fail(`expected "${op}" but found "${this.peek().value || "end of program"}"`);
  }

  private expectIdent(): string {
    const t = this.peek();
    if (t.kind !== "ident") this.fail(`expected a name but found "${t.value || "end of program"}"`);
    this.pos++;
    return t.value;
  }

  private fail(message: string): never {
    const t = this.peek();
    throw new BugsSyntaxError(message, t.line, t.col);
  }
}

// Printing. Parentheses come from the AST, so output follows the source.

const printIndex = (items: IndexItem[]): string =>
  items
    .map((it) => {
      if (it === null) return "";
      if (it.kind === "range")
        return `${it.lo ? printExpr(it.lo) : ""}:${it.hi ? printExpr(it.hi) : ""}`;
      return printExpr(it);
    })
    .join(", ");

export function printExpr(e: Expr): string {
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

export const printVarRef = (v: VarRef): string =>
  v.index ? `${v.name}[${printIndex(v.index)}]` : v.name;
export const printIndices = (v: VarRef): string => (v.index ? printIndex(v.index) : "");

/** Every variable name an expression reads, excluding the given loop variables and any called function. */
export function referencedNames(
  e: Expr | IndexItem,
  skip: ReadonlySet<string>,
  out = new Set<string>(),
): Set<string> {
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
      for (const it of e.index ?? []) referencedNames(it, skip, out);
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
