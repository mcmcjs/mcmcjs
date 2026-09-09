// Regenerate the notebooks the editor's "Open in Colab" button links to.
//
// Colab can only open a notebook from GitHub, so these are committed rather
// than produced in the browser. They are the same output `generateNotebook`
// gives the Run tab, for the bundled Rats example.
//
//   pnpm gen:notebooks

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "notebooks");

const { generateNotebook } = await import(
  join(root, "packages/doodleppl/dist/codegen/notebook.js")
);
/**
 * The notebooks the Run tab's Colab links open. They are templates: generic
 * notebooks that fit whatever graph is pasted into their first cell, because
 * Colab cannot be handed a notebook the editor just built.
 */
export function buildNotebooks() {
  const out = {};
  for (const target of ["juliabugs", "stan"]) {
    out[`template_${target}.ipynb`] = generateNotebook({ target, name: `${target} template` });
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
