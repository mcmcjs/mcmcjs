// The spec's `[output] keep` list: which variables a samples file stores.
//
// A pattern matches a variable by its full scalarised name (`theta[2]`), by its
// base name before the subscript (`theta` keeps every element), or as a glob
// with `*` against either. The Julia driver applies the same rule in
// `keep_matches`; keep the two in step.

import type { Samples } from "./types";

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function keepMatcher(patterns: readonly string[]): (name: string) => boolean {
  const rules = patterns.map((p) =>
    p.includes("*") ? new RegExp(`^${p.split("*").map(escapeRegExp).join(".*")}$`) : p,
  );
  return (name) => {
    const base = name.split("[", 1)[0] ?? name;
    return rules.some((r) =>
      typeof r === "string" ? r === name || r === base : r.test(name) || r.test(base),
    );
  };
}

/**
 * The samples restricted to the variables `patterns` name. Sampler statistics
 * are untouched. No patterns means no filtering.
 */
export function keepSamples(samples: Samples, patterns?: readonly string[]): Samples {
  if (!patterns || patterns.length === 0) return samples;
  const matches = keepMatcher(patterns);
  const variables = samples.variables.filter(matches);
  const draws = new Map<string, Float64Array>();
  for (const v of variables) {
    const d = samples.draws.get(v);
    if (d) draws.set(v, d);
  }
  return { ...samples, variables, draws };
}
