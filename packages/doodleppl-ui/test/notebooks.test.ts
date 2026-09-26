import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// The Run tab's "Open in Colab" button links to these committed notebooks,
// because Colab can only open one from GitHub. They are generated, so this
// fails if the generator moves on and they are not regenerated.
const root = fileURLToPath(new URL("../../..", import.meta.url));
const { buildNotebooks } = await import(join(root, "scripts/gen-notebooks.mjs"));

const expected: Record<string, string> = buildNotebooks();

describe("the notebooks the Colab links open", () => {
  it("covers both backends", () => {
    expect(Object.keys(expected).sort()).toEqual([
      "template_juliabugs.ipynb",
      "template_stan.ipynb",
    ]);
  });

  for (const [name, content] of Object.entries(expected)) {
    it(`${name} is current`, () => {
      const onDisk = readFileSync(join(root, "notebooks", name), "utf8");
      expect(onDisk, `${name} is stale; run \`pnpm gen:notebooks\``).toBe(content);
    });

    it(`${name} is a valid template that takes a pasted graph`, () => {
      const nb = JSON.parse(content) as {
        nbformat: number;
        cells: { cell_type: string; source: string[] }[];
      };
      expect(nb.nbformat).toBe(4);
      expect(nb.cells.length).toBeGreaterThan(3);
      const text = nb.cells.map((c) => c.source.join("")).join("\n");
      // An empty paste slot, editable settings, and the CLI workflow.
      expect(text).toContain("GRAPH = r");
      expect(text).toContain("Paste your graph above");
      expect(text).toContain("CHAINS = ");
      expect(text).toContain("https://mcmcjs.github.io/install.sh");
      expect(text).toContain("mcmc run model.toml");
      // A template carries no model of its own.
      expect(text).not.toContain("nodeType");
    });
  }
});
