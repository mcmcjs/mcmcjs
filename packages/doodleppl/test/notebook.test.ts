import { describe, expect, it } from "vitest";
import {
  colabUrl,
  generateNotebook,
  graphJsonForPython,
  type NotebookInput,
  notebookFilename,
} from "../src/codegen/notebook";
import type { UnifiedModelData } from "../src/core/types";

const GRAPH: UnifiedModelData = {
  name: "Rats: growth",
  version: 1,
  elements: [
    {
      id: "mu",
      name: "mu",
      type: "node",
      nodeType: "stochastic",
      distribution: "dnorm",
      param1: "0",
      param2: "0.001",
    },
    {
      id: "y",
      name: "y",
      type: "node",
      nodeType: "observed",
      observed: true,
      distribution: "dnorm",
      param1: "mu",
      param2: "1",
    },
    { id: "e", type: "edge", source: "mu", target: "y" },
  ],
  dataContent: JSON.stringify({ data: { y: [1, 2, 3] }, inits: { mu: 0 } }),
};

const input = (over: Partial<NotebookInput> = {}): NotebookInput => ({
  target: "juliabugs",
  name: "Rats: growth",
  graph: GRAPH,
  settings: { n_samples: 500, n_adapts: 250, n_chains: 2, seed: 42 },
  ...over,
});

const parse = (i: NotebookInput) => JSON.parse(generateNotebook(i));
const sourceOf = (nb: { cells: { source: string[] }[] }) =>
  nb.cells.map((c) => c.source.join("")).join("\n");

describe("generateNotebook", () => {
  for (const target of ["juliabugs", "stan"] as const) {
    describe(target, () => {
      const nb = parse(input({ target }));
      const text = sourceOf(nb);

      it("is a valid nbformat 4 document on the Python kernel", () => {
        expect(nb.nbformat).toBe(4);
        // Colab gives a Python runtime; both targets have to work on it.
        expect(nb.metadata.kernelspec.name).toBe("python3");
        expect(nb.metadata.language_info.name).toBe("python");
        expect(nb.cells.length).toBeGreaterThan(6);
      });

      it("every cell has the shape nbformat requires", () => {
        for (const cell of nb.cells) {
          expect(["markdown", "code"]).toContain(cell.cell_type);
          expect(cell.source.length).toBeGreaterThan(0);
          for (const line of cell.source.slice(0, -1)) expect(line.endsWith("\n")).toBe(true);
          expect(cell.source.at(-1)?.endsWith("\n")).toBe(false);
          if (cell.cell_type === "code") {
            expect(cell.execution_count).toBeNull();
            expect(cell.outputs).toEqual([]);
          }
        }
      });

      it("opens with the model's name and carries the graph as its input", () => {
        expect(nb.cells[0].cell_type).toBe("markdown");
        expect(nb.cells[0].source.join("")).toContain("Rats: growth");
        // The graph document itself, not pre-generated model code.
        expect(text).toContain('"nodeType": "stochastic"');
        expect(text).toContain('with open("model.json", "w")');
      });

      it("installs the CLI without needing Node, and the right toolchain", () => {
        expect(text).toContain("https://mcmcjs.github.io/install.sh");
        expect(text).toContain(`mcmc setup --engine ${target === "stan" ? "stan" : "julia"}`);
      });

      it("walks the whole workflow through the CLI", () => {
        expect(text).toContain("mcmc convert model.json");
        expect(text).toContain("mcmc run model.toml");
        expect(text).toContain("mcmc summary");
        expect(text).toContain("mcmc diagnose");
        expect(text).toContain("mcmc plot --kind");
        expect(text).toContain("mcmc export bundle");
      });

      it("draws plots inline and links the report app", () => {
        expect(text).toContain("from IPython.display import SVG, display");
        for (const kind of ["trace", "density", "forest", "rank"]) expect(text).toContain(kind);
        expect(text).toContain("https://mcmcjs.github.io/report/");
      });
    });
  }

  it("converts to Stan only for the Stan target", () => {
    expect(sourceOf(parse(input({ target: "stan" })))).toContain("mcmc convert model.json --stan");
    expect(sourceOf(parse(input()))).not.toContain("--stan");
  });

  // The embedded graph is a Python raw string, so what Python reads back must
  // be byte-for-byte the JSON that went in. Getting this wrong is silent in the
  // notebook file and only fails when a cell runs, so it is checked directly.
  const embedded = (text: string, name: "GRAPH") => {
    const quote = "'".repeat(3);
    const start = text.indexOf(`${name} = r${quote}\n`);
    expect(start, `${name} raw block`).toBeGreaterThanOrEqual(0);
    const from = start + `${name} = r${quote}\n`.length;
    return text.slice(from, text.indexOf(`\n${quote}`, from));
  };

  it("the embedded graph parses back as the graph that went in", () => {
    const text = sourceOf(parse(input()));
    expect(JSON.parse(embedded(text, "GRAPH"))).toEqual(JSON.parse(JSON.stringify(GRAPH)));
  });

  it("a graph carrying quotes, newlines and backslashes survives the round trip", () => {
    const quote = "'".repeat(3);
    const graph: UnifiedModelData = {
      ...GRAPH,
      // Every character that has broken this: a triple quote (would close the
      // block), and JSON escapes that an interpreted string would eat.
      name: `odd ${quote} name`,
      dataContent: JSON.stringify({ data: { note: 'a \\ backslash, a "quote", a\nnewline' } }),
    };
    const text = sourceOf(parse(input({ graph })));
    expect(text).not.toContain(`"name": "odd ${quote}`);
    const back = JSON.parse(embedded(text, "GRAPH")) as UnifiedModelData;
    expect(back.name).toBe(graph.name);
    // The inner JSON is still parseable, which is what the notebook relies on.
    expect(JSON.parse(back.dataContent as string)).toEqual({
      data: { note: 'a \\ backslash, a "quote", a\nnewline' },
    });
  });

  it("graphJsonForPython emits JSON with no single quote to close a raw block", () => {
    const out = graphJsonForPython({ name: "it's a 'test'" });
    expect(out).not.toContain("'");
    expect(JSON.parse(out)).toEqual({ name: "it\u0027s a \u0027test\u0027" });
  });

  it("survives an empty graph", () => {
    expect(() => generateNotebook(input({ graph: { name: "empty", elements: [] } }))).not.toThrow();
  });

  it("a template is an empty paste slot that refuses to run empty", () => {
    const quote = "'".repeat(3);
    const text = sourceOf(parse(input({ graph: undefined })));
    expect(text).toContain(`GRAPH = r${quote}\n\n${quote}`);
    expect(text).toContain("Paste your graph above");
    // A template carries no model of its own, and does not claim one.
    expect(text).not.toContain("# Rats: growth");
    expect(text).not.toContain("nodeType");
  });

  it("the settings the notebook opens with drive the run", () => {
    const text = sourceOf(parse(input()));
    expect(text).toContain("CHAINS = 2");
    expect(text).toContain("DRAWS = 500");
    expect(text).toContain("WARMUP = 250");
    expect(text).toContain("SEED = 42");
    // The run reads the variables rather than baking the numbers in again.
    expect(text).toContain(
      "!mcmc run model.toml --chains {CHAINS} --draws {DRAWS} --warmup {WARMUP}{seed_flag}",
    );
  });

  it("no seed becomes None, which the run turns into no flag", () => {
    const text = sourceOf(
      parse(input({ settings: { n_samples: 10, n_adapts: 5, n_chains: 1, seed: null } })),
    );
    expect(text).toContain("SEED = None");
    expect(text).toContain('f" --seed {SEED}" if SEED is not None else ""');
  });
});

describe("notebookFilename", () => {
  it("slugs the model name and names the target", () => {
    expect(notebookFilename("Rats: growth", "juliabugs")).toBe("rats_growth_juliabugs.ipynb");
    expect(notebookFilename("  Eight Schools  ", "stan")).toBe("eight_schools_stan.ipynb");
  });

  it("falls back when a name has nothing usable", () => {
    expect(notebookFilename("***", "stan")).toBe("model_stan.ipynb");
  });
});

describe("colabUrl", () => {
  it("defaults to main", () => {
    expect(colabUrl("notebooks/rats_juliabugs.ipynb")).toBe(
      "https://colab.research.google.com/github/mcmcjs/mcmcjs/blob/main/notebooks/rats_juliabugs.ipynb",
    );
  });

  it("takes the ref that carries the file, so a preview build points at its own branch", () => {
    expect(colabUrl("notebooks/rats_stan.ipynb", "code-run-tabs")).toBe(
      "https://colab.research.google.com/github/mcmcjs/mcmcjs/blob/code-run-tabs/notebooks/rats_stan.ipynb",
    );
  });
});
