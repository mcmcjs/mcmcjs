// Run `mcmc graph` over every fixture program in all three formats and report
// what failed. Output lands in cli/ next to the widget documents in out/.
//
//   node render-all.mjs

import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "../..");
const mcmc = join(root, "packages/cli/dist/index.js");
const fixtures = JSON.parse(readFileSync(join(here, "fixtures/programs.json"), "utf8"));

const src = join(here, "cli/src");
const out = join(here, "cli");
mkdirSync(src, { recursive: true });

const failures = [];
let png = 0;
for (const f of fixtures) {
  const bugs = join(src, `${f.key}.bugs`);
  const data = join(src, `${f.key}.data.json`);
  writeFileSync(bugs, f.program);
  writeFileSync(data, JSON.stringify(Object.fromEntries(f.data_keys.map((k) => [k, 0]))));

  for (const format of ["svg", "json", "png"]) {
    const target = join(out, `${f.key}.${format}`);
    const r = spawnSync(
      "node",
      [mcmc, "graph", bugs, "--data", data, "--format", format, "--theme", "light", "-o", target],
      { encoding: "utf8" },
    );
    if (r.status !== 0) {
      if (format === "png" && /resvg/.test(r.stderr)) continue;
      failures.push(`${f.key} ${format}: ${r.stderr.trim().split("\n").pop()}`);
    } else if (format === "png") {
      png++;
    }
  }
}

console.log(`rendered ${fixtures.length} programs to ${out} (${png} with PNG)`);
if (failures.length) {
  console.log("failed:");
  for (const line of failures) console.log(`  ${line}`);
  process.exit(1);
}
