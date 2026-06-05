/**
 * Deterministic data generators for the diagnostics tests (no RNG seeding needed,
 * so results are reproducible). Not part of the published package.
 */

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** A chain of `n` independent Uniform(0, 1) draws, optionally shifted. */
export function uniformChain(n: number, seed: number, shift = 0): Float64Array {
  const next = lcg(seed);
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) out[i] = next() + shift;
  return out;
}

/** A chain of `n` AR(1) draws with coefficient `phi` (autocorrelated). */
export function ar1Chain(n: number, seed: number, phi: number): Float64Array {
  const next = lcg(seed);
  const out = new Float64Array(n);
  let x = 0;
  for (let i = 0; i < n; i++) {
    x = phi * x + (next() - 0.5);
    out[i] = x;
  }
  return out;
}
