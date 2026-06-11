/** Commander option parsers shared across commands. */

export function parseIntOption(value: string): number {
  const n = Number.parseInt(value, 10);
  if (!Number.isInteger(n)) throw new Error(`expected an integer, got "${value}"`);
  return n;
}

export function parseFloatOption(value: string): number {
  const n = Number.parseFloat(value);
  if (!Number.isFinite(n)) throw new Error(`expected a number, got "${value}"`);
  return n;
}
