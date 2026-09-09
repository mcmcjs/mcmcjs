// Regenerate the notebooks the editor's "Open in Colab" button links to.
//
// Colab can only open a notebook from GitHub, so these are committed rather
// than produced in the browser. They are the same output `generateNotebook`
// gives the Run tab, for the bundled Rats example.
//
//   pnpm gen:notebooks

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const example = join(root, "packages/doodleppl-ui/src/widget/config/examples/rats.json");
const outDir = join(root, "notebooks");

const { generateNotebook } = await import(
  join(root, "packages/doodleppl/dist/codegen/notebook.js")
);
const { parseUnifiedModel } = await import(join(root, "packages/doodleppl/dist/index.js"));

/** The notebooks the Run tab's Colab links point at, keyed by target. */
export function buildNotebooks() {
  const graph = parseUnifiedModel(readFileSync(example, "utf8"));
  const settings = { n_samples: 1000, n_adapts: 1000, n_chains: 2, seed: 42 };
  const out = {};
  for (const target of ["juliabugs", "stan"]) {
    out[`rats_${target}.ipynb`] = generateNotebook({
      target,
      name: graph.name,
      graph,
      settings,
    });
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  mkdirSync(outDir, { recursive: true });
  for (const [name, content] of Object.entries(buildNotebooks())) {
    writeFileSync(join(outDir, name), content);
    process.stdout.write(`wrote ${join("notebooks", name)}\n`);
  }
}
