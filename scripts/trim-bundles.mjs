#!/usr/bin/env node
// Rounding to 6 decimals halves a bundle and costs nothing a plot or an R-hat needs.
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const DECIMALS = 6;
const INDEX = "index.json";

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

function main(dir) {
  const names = readdirSync(dir).filter((f) => f.endsWith(".json") && f !== INDEX);
  const runs = [];
  for (const name of names) {
    const path = join(dir, name);
    const before = statSync(path).size;
    const bundle = trim(JSON.parse(readFileSync(path, "utf8")));
    writeFileSync(path, JSON.stringify(bundle));
    const after = statSync(path).size;
    runs.push(indexEntry(name, bundle, after));
    console.log(`${name}: ${(before / 1024) | 0} KB -> ${(after / 1024) | 0} KB`);
  }
  runs.sort((a, b) => a.key.localeCompare(b.key));
  writeFileSync(join(dir, INDEX), JSON.stringify({ runs }, null, 2));
  console.log(`indexed ${runs.length} bundle(s)`);
}

if (process.argv[1]?.endsWith("trim-bundles.mjs")) main(process.argv[2] ?? ".");
