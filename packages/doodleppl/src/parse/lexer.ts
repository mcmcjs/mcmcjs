// Tokenizer for the BUGS model language (WinBUGS, OpenBUGS, JAGS, MultiBUGS).

export type TokenKind = "ident" | "number" | "op" | "eof";

export interface Token {
  kind: TokenKind;
  value: string;
  line: number;
  col: number;
}

export class BugsSyntaxError extends Error {
  constructor(
    message: string,
    public readonly line: number,
    public readonly col: number,
  ) {
    super(`${message} (line ${line}, column ${col})`);
    this.name = "BugsSyntaxError";
  }
}

// Longest operators first so `<-` wins over `<`.
const OPERATORS = [
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
  "!",
];

const isIdentStart = (c: string) => /[A-Za-z_]/.test(c);
// BUGS names may contain dots (`tau.c`, `alpha.tau`).
const isIdentPart = (c: string) => /[A-Za-z0-9_.]/.test(c);
const isDigit = (c: string) => /[0-9]/.test(c);

export function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  let line = 1;
  let lineStart = 0;

  const push = (kind: TokenKind, value: string, at: number) =>
    tokens.push({ kind, value, line, col: at - lineStart + 1 });
  // Past the end reads as "", so lookahead never needs a bounds check.
  const at = (k: number): string => src[k] ?? "";

  while (i < src.length) {
    const c = at(i);

    if (c === "\n") {
      line++;
      i++;
      lineStart = i;
      continue;
    }
    if (c === " " || c === "\t" || c === "\r") {
      i++;
      continue;
    }
    if (c === "#") {
      while (i < src.length && at(i) !== "\n") i++;
      continue;
    }

    const start = i;

    if (isDigit(c) || (c === "." && isDigit(at(i + 1)))) {
      while (i < src.length && isDigit(at(i))) i++;
      if (at(i) === "." && isDigit(at(i + 1))) {
        i++;
        while (i < src.length && isDigit(at(i))) i++;
      } else if (at(i) === "." && !isIdentPart(at(i + 1))) {
        // `1.` as a literal
        i++;
      }
      if ((at(i) === "e" || at(i) === "E") && /[-+0-9]/.test(at(i + 1))) {
        i++;
        if (at(i) === "+" || at(i) === "-") i++;
        while (i < src.length && isDigit(at(i))) i++;
      }
      push("number", src.slice(start, i), start);
      continue;
    }

    if (isIdentStart(c)) {
      while (i < src.length && isIdentPart(at(i))) i++;
      // A trailing dot belongs to the syntax, not the name (rare, but `x.` is not a name).
      while (at(i - 1) === "." && i > start + 1) i--;
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
