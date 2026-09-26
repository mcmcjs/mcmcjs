// A node name typeset the way a figure in a paper would write it: `mu[i]` as μ with
// subscript i, `alpha.c` as α with subscript c, `beta0` as β with subscript 0.

const GREEK: Record<string, string> = {
  alpha: "α",
  beta: "β",
  gamma: "γ",
  delta: "δ",
  epsilon: "ε",
  zeta: "ζ",
  eta: "η",
  theta: "θ",
  iota: "ι",
  kappa: "κ",
  lambda: "λ",
  mu: "μ",
  nu: "ν",
  xi: "ξ",
  pi: "π",
  rho: "ρ",
  sigma: "σ",
  tau: "τ",
  upsilon: "υ",
  phi: "φ",
  chi: "χ",
  psi: "ψ",
  omega: "ω",
  Gamma: "Γ",
  Delta: "Δ",
  Theta: "Θ",
  Lambda: "Λ",
  Xi: "Ξ",
  Pi: "Π",
  Sigma: "Σ",
  Upsilon: "Υ",
  Phi: "Φ",
  Psi: "Ψ",
  Omega: "Ω",
};

/** One piece of a label: a Greek letter, or plain text set in italics. */
export interface LabelPart {
  text: string;
  greek: boolean;
}

export interface Label {
  base: LabelPart;
  /** Subscript pieces in order, joined with commas when typeset. */
  subscript: LabelPart[];
}

const part = (text: string): LabelPart => ({ text, greek: text in GREEK });

/** Split a node name and its indices into a base symbol and subscripts. */
export function nodeLabel(name: string, indices?: string): Label {
  const [head = name, ...suffixes] = name.split(".");
  const subscript: LabelPart[] = [];
  let base = head;
  // A trailing number is a subscript only after a single letter or a Greek name, so
  // `beta0` becomes β₀ while a word such as `log10` stays whole.
  const digits = /^([A-Za-z]+?)(\d+)$/.exec(head);
  const letters = digits?.[1];
  if (digits && letters && (letters in GREEK || letters.length === 1)) {
    base = letters;
    subscript.push(part(digits[2] as string));
  }
  for (const s of suffixes) if (s) subscript.push(part(s));
  for (const i of (indices ?? "").split(",")) {
    const trimmed = i.trim();
    if (trimmed) subscript.push(part(trimmed));
  }
  return { base: part(base), subscript };
}

/** Escape the characters LaTeX treats as commands inside maths. */
export const texEscape = (s: string) => s.replace(/[\\{}_^#%&$~]/g, (c) => `\\${c}`);

function texPart(p: LabelPart): string {
  if (p.greek) return `\\${p.text}`;
  // One letter or an index expression reads as maths; a word needs \mathit to keep its kerning.
  return /^[A-Za-z][A-Za-z0-9]+$/.test(p.text)
    ? `\\mathit{${texEscape(p.text)}}`
    : texEscape(p.text);
}

/** The label as LaTeX maths, without the surrounding dollars. */
export function labelTex(label: Label): string {
  const base = texPart(label.base);
  if (label.subscript.length === 0) return base;
  return `${base}_{${label.subscript.map(texPart).join(",")}}`;
}

/** The label as plain Unicode text pieces, for SVG. */
export function labelText(label: Label): { base: string; subscript: string } {
  const text = (p: LabelPart) => (p.greek ? (GREEK[p.text] as string) : p.text);
  return { base: text(label.base), subscript: label.subscript.map(text).join(",") };
}

/** Width of one character of 10pt maths italic in centimetres, measured with pdflatex. */
function charWidth(c: string): number {
  if (/[ijlt,.fr]/.test(c)) return 0.12;
  if (/[mwMW]/.test(c)) return 0.28;
  if (/[A-Z]/.test(c)) return 0.24;
  if (/\d/.test(c)) return 0.176;
  if (/[Ͱ-Ͽ]/.test(c)) return 0.22;
  return 0.19;
}

const textWidth = (s: string) => [...s].reduce((sum, c) => sum + charWidth(c), 0);

/** A close estimate of the typeset label's size in centimetres, at a 10pt body size. */
export function labelSize(label: Label): { width: number; height: number } {
  const { base, subscript } = labelText(label);
  if (!subscript) return { width: textWidth(base), height: 0.25 };
  return { width: textWidth(base) + 0.7 * textWidth(subscript) + 0.03, height: 0.34 };
}
