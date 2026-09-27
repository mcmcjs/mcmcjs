#!/usr/bin/env node
// Prepares a directory of run bundles for publishing: rounds the draws, drops any
// bundle the host cannot take, and writes index.json.
//
//   node trim-bundles.mjs <dir> [--merge <existing index.json>]
//
// Rounding to 6 decimals halves a bundle and costs nothing a plot or an R-hat needs.
// GitHub refuses files over 100 MB, and one such file fails the whole push, so a
// bundle still above the cap after rounding is removed rather than published.
// --merge keeps the entries of an earlier index whose bundles this run did not
// refit, so publishing one volume at a time leaves the others listed.
import { readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const DECIMALS = 6;
const INDEX = "index.json";
export const MAX_BYTES = 95 * 1024 * 1024;

export function trim(bundle) {
  const values = bundle?.samples?.value_flat;
  if (!Array.isArray(values)) return bundle;
  for (let i = 0; i < values.length; i++) {
    if (typeof values[i] === "number") values[i] = Number(values[i].toFixed(DECIMALS));
  }
  return bundle;
}

export function indexEntry(name, bundle, bytes) {
  const entry = bundle.entry ?? {};
  return {
    key: name.replace(/\.json$/, ""),
    file: name,
    model: entry.model_path ?? null,
    backend: entry.backend ?? null,
    sampler: entry.sampler ?? null,
    converged: entry.diagnostics?.converged ?? null,
    rhat_max: entry.diagnostics?.rhat_max ?? null,
    fitted_at: entry.started_at ?? null,
    bytes,
  };
}

/** New entries win; earlier entries survive only for keys this run did not produce. */
export function mergeRuns(fresh, earlier) {
  const keys = new Set(fresh.map((r) => r.key));
  const runs = [...fresh, ...earlier.filter((r) => !keys.has(r.key))];
  return runs.sort((a, b) => a.key.localeCompare(b.key));
}

function main(dir, mergeFrom) {
  const names = readdirSync(dir).filter((f) => f.endsWith(".json") && f !== INDEX);
  const runs = [];
  for (const name of names) {
    const path = join(dir, name);
    const before = statSync(path).size;
    const bundle = trim(JSON.parse(readFileSync(path, "utf8")));
    writeFileSync(path, JSON.stringify(bundle));
    const after = statSync(path).size;
    if (after > MAX_BYTES) {
      unlinkSync(path);
      console.log(
        `${name}: ${(after / 1048576) | 0} MB is over the ${(MAX_BYTES / 1048576) | 0} MB cap, not published`,
      );
      continue;
    }
    runs.push(indexEntry(name, bundle, after));
    console.log(`${name}: ${(before / 1024) | 0} KB -> ${(after / 1024) | 0} KB`);
  }
  let earlier = [];
  if (mergeFrom) {
    try {
      earlier = JSON.parse(readFileSync(mergeFrom, "utf8")).runs ?? [];
    } catch {
      console.log(`no earlier index at ${mergeFrom}; starting fresh`);
    }
  }
  const merged = mergeRuns(runs, earlier);
  writeFileSync(join(dir, INDEX), JSON.stringify({ runs: merged }, null, 2));
  console.log(`indexed ${runs.length} new bundle(s), ${merged.length} in total`);
}

if (process.argv[1]?.endsWith("trim-bundles.mjs")) {
  const args = process.argv.slice(2);
  const at = args.indexOf("--merge");
  const mergeFrom = at >= 0 ? args[at + 1] : undefined;
  const dir = args.find((a, i) => a !== "--merge" && i !== at + 1) ?? ".";
  main(dir, mergeFrom);
}
