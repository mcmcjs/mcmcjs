import { describe, expect, it } from "vitest";
import {
  colabUrl,
  generateNotebook,
  type NotebookInput,
  notebookFilename,
} from "../src/codegen/notebook";
import type { GraphElement } from "../src/core/types";

const ELEMENTS: GraphElement[] = [
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
];

const input = (over: Partial<NotebookInput> = {}): NotebookInput => ({
  target: "juliabugs",
  name: "Rats: growth",
  modelCode: "model {\n  y ~ dnorm(mu, 1)\n  mu ~ dnorm(0, 0.001)\n}",
  data: { y: [1, 2, 3], N: 3 },
  inits: { mu: 0 },
  elements: ELEMENTS,
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

      it("is a valid nbformat 4 document on the Python kernel", () => {
        expect(nb.nbformat).toBe(4);
        expect(nb.metadata.kernelspec.name).toBe("python3");
        // Colab gives a Python runtime; both targets have to work on it.
        expect(nb.metadata.language_info.name).toBe("python");
        expect(nb.cells.length).toBeGreaterThan(3);
      });

      it("every cell has the shape nbformat requires", () => {
        for (const cell of nb.cells) {
          expect(["markdown", "code"]).toContain(cell.cell_type);
          expect(Array.isArray(cell.source)).toBe(true);
          expect(cell.source.length).toBeGreaterThan(0);
          // Every line but the last keeps its newline.
          for (const line of cell.source.slice(0, -1)) expect(line.endsWith("\n")).toBe(true);
          expect(cell.source.at(-1)?.endsWith("\n")).toBe(false);
          if (cell.cell_type === "code") {
            expect(cell.execution_count).toBeNull();
            expect(cell.outputs).toEqual([]);
          }
        }
      });

      it("opens with the model's name and carries the model code", () => {
        expect(nb.cells[0].cell_type).toBe("markdown");
        expect(nb.cells[0].source.join("")).toContain("Rats: growth");
        expect(sourceOf(nb)).toContain("dnorm(mu, 1)");
      });

      it("installs what it needs and prints a summary", () => {
        const text = sourceOf(nb);
        expect(text).toContain("%pip install");
        expect(text).toMatch(target === "stan" ? /cmdstanpy/ : /juliacall/);
      });
    });
  }

  it("the JuliaBUGS notebook runs the same script the download produces", () => {
    const text = sourceOf(parse(input()));
    // The script is written to a file and included, so there is one Julia path.
    expect(text).toContain("using JuliaBUGS");
    expect(text).toContain('with open("run.jl", "w")');
    expect(text).toContain('jl.include("run.jl")');
  });

  it("the Stan notebook carries data, inits and the sampler settings", () => {
    const text = sourceOf(parse(input({ target: "stan", modelCode: "parameters { real mu; }" })));
    expect(text).toContain("cmdstanpy.CmdStanModel");
    expect(text).toContain("iter_sampling=500");
    expect(text).toContain("iter_warmup=250");
    expect(text).toContain("chains=2");
    expect(text).toContain("seed=42");
  });

  it("omits the seed when there is none, rather than writing null", () => {
    const text = sourceOf(
      parse(input({ target: "stan", settings: { n_samples: 10, n_adapts: 5, n_chains: 1 } })),
    );
    expect(text).not.toContain("seed=");
  });

  it("model code that would close a Python string early stays inside it", () => {
    const nasty = "model {\n  # ''' and a \\ backslash\n}";
    const text = sourceOf(parse(input({ target: "stan", modelCode: nasty })));
    // The raw block is still delimited by exactly two triple quotes per cell.
    expect(text).toContain("\\'\\'\\'");
    expect(() =>
      JSON.parse(generateNotebook(input({ target: "stan", modelCode: nasty }))),
    ).not.toThrow();
  });

  it("survives an empty graph", () => {
    expect(() =>
      generateNotebook(input({ target: "stan", elements: [], data: {}, inits: {} })),
    ).not.toThrow();
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
  it("points at a notebook committed to GitHub", () => {
    expect(colabUrl("notebooks/rats_juliabugs.ipynb")).toBe(
      "https://colab.research.google.com/github/mcmcjs/mcmcjs/blob/main/notebooks/rats_juliabugs.ipynb",
    );
  });
});
