import type { Charset } from "./canvas";

// One-row height ramps: nine levels from empty to full.
const RAMP: Record<Charset, string> = {
  unicode: " ▁▂▃▄▅▆▇█",
  ascii: " .:-=+*#%",
};

/** A single ramp glyph for a fraction in [0, 1] of the cell height. */
export function blockBar(fraction: number, charset: Charset = "unicode"): string {
  const chars = RAMP[charset];
  const f = Math.max(0, Math.min(1, fraction));
  return chars[Math.round(f * (chars.length - 1))] ?? chars[0] ?? " ";
}

/** A one-line sparkline of `values` scaled to `max` (defaults to the data max). */
export function sparkline(
  values: number[],
  opts: { max?: number; charset?: Charset } = {},
): string {
  const charset = opts.charset ?? "unicode";
  const max = opts.max ?? Math.max(0, ...values);
  if (max <= 0) return blockBar(0, charset).repeat(values.length);
  return values.map((v) => blockBar(v / max, charset)).join("");
}
