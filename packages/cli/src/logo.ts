import pc from "picocolors";

/**
 * The wordmark, three rows of block glyphs. Each letter takes the colour of one
 * chain in the plot palette, so four chains read across the four letters.
 */
const LETTERS: Record<string, [string, string, string]> = {
  M: ["█▀▄▀█", "█ ▀ █", "▀   ▀"],
  C: ["█▀▀", "█  ", "▀▀▀"],
};

const WORD = "MCMC";
const CHAIN_COLORS = [pc.cyan, pc.green, pc.yellow, pc.magenta] as const;

/** A braille trace under the wordmark, the same glyphs the terminal plots use. */
const TRACE = "⢀⡠⠔⠒⠉⠑⠢⢄⡀⣀⠤⠒⠊⠉⠒⠤⣀⡠⠔⠉⠑⠢⣀";

export interface BannerOptions {
  /** Left padding, so it lines up with the text that follows. */
  indent?: string;
  color?: boolean;
  trace?: boolean;
}

/**
 * The banner as a block of lines. Colour goes through picocolors, which is
 * already silent on a non-TTY and under NO_COLOR.
 */
export function banner(opts: BannerOptions = {}): string {
  const indent = opts.indent ?? "  ";
  const paint = (text: string, at: number): string => {
    if (opts.color === false) return text;
    return (CHAIN_COLORS[at % CHAIN_COLORS.length] ?? pc.white)(text);
  };
  const glyphs = [...WORD].map((letter) => LETTERS[letter] as [string, string, string]);
  const rows = [0, 1, 2].map((row) =>
    glyphs.map((glyph, at) => paint(glyph[row] as string, at)).join(" "),
  );
  const lines = rows.map((row) => `${indent}${row}`);
  if (opts.trace !== false) {
    lines.push(`${indent}${opts.color === false ? TRACE : pc.dim(TRACE)}`);
  }
  return lines.join("\n");
}

/** Visible width of one banner row, for tests and layout. */
export function bannerWidth(): number {
  return [...WORD].reduce((total, letter, at) => {
    const glyph = (LETTERS[letter] as [string, string, string])[0];
    return total + glyph.length + (at > 0 ? 1 : 0);
  }, 0);
}
