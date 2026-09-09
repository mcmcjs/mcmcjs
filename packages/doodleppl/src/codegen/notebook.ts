// A runnable Jupyter notebook for a graph, in the flavour Google Colab opens.
//
// The notebook's input is the graph document and every step is the mcmc CLI:
// convert, run, summary, diagnose, plot, export. That is one code path for both
// backends, and the same workflow the CLI gives you locally, so the notebook
// cannot drift from the tool it demonstrates.
//
// Cells run on the Python kernel, which is what Colab provides; the CLI is a
// self-contained binary, so nothing needs Node.

import type { UnifiedModelData } from "../core/types";

export type NotebookTarget = "juliabugs" | "stan";

/** Defaults written into the notebook's settings cell, editable there. */
export interface NotebookSettings {
  n_samples: number;
  n_adapts: number;
  n_chains: number;
  seed?: number | null;
}

export interface NotebookInput {
  target: NotebookTarget;
  /** The graph's name, used for the title and the suggested filename. */
  name: string;
  /**
   * The graph the notebook fits. Leave it out for a template: a notebook that
   * fits whatever is pasted into it, which is what the editor's Colab links
   * open, since Colab cannot be handed a notebook built in the browser.
   */
  graph?: UnifiedModelData;
  settings?: NotebookSettings;
}

const DEFAULTS: NotebookSettings = { n_samples: 1000, n_adapts: 1000, n_chains: 2, seed: 42 };

interface Cell {
  cell_type: "markdown" | "code";
  metadata: Record<string, unknown>;
  source: string[];
  execution_count?: null;
  outputs?: unknown[];
}

/** Notebook `source` is a list of lines, each keeping its newline but the last. */
function lines(text: string): string[] {
  const parts = text.replace(/\n+$/, "").split("\n");
  return parts.map((l, i) => (i === parts.length - 1 ? l : `${l}\n`));
}

const markdown = (text: string): Cell => ({
  cell_type: "markdown",
  metadata: {},
  source: lines(text),
});

const code = (text: string): Cell => ({
  cell_type: "code",
  metadata: {},
  execution_count: null,
  outputs: [],
  source: lines(text),
});

const QUOTE = "'".repeat(3);

/**
 * A graph as JSON that is safe inside a Python raw triple-quoted string.
 *
 * Raw is the only correct choice: the JSON carries `\"` and `\n` as two
 * characters each, and a string that interprets escapes would turn them into
 * real quotes and newlines, which is not the JSON any more. A raw string cannot
 * escape its own delimiter, so single quotes go out as `'`, which JSON
 * reads back as `'` and which cannot close the block.
 */
export function graphJsonForPython(graph: unknown): string {
  return JSON.stringify(graph, null, 2).replace(/'/g, "\\u0027");
}

/** A slug safe as a filename, e.g. "Rats: growth" -> "rats_growth". */
export function notebookFilename(name: string, target: NotebookTarget): string {
  const slug =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || "model";
  return `${slug}_${target}.ipynb`;
}

const LABEL: Record<NotebookTarget, string> = { juliabugs: "JuliaBUGS", stan: "Stan" };
const ENGINE: Record<NotebookTarget, string> = { juliabugs: "julia", stan: "stan" };

/** The plots the notebook draws, covering both convergence and shape. */
const PLOT_KINDS = ["trace", "density", "forest", "rank"];

function modelCells(input: NotebookInput): Cell[] {
  if (input.graph) {
    return [
      markdown(
        "## Model\n\nThe graph as it was drawn, with its data and initial values.\n\n" +
          "To fit a different one, press **Copy graph** in the editor's Run tab and replace the " +
          "JSON below.",
      ),
      code(
        `GRAPH = r${QUOTE}\n${graphJsonForPython(input.graph)}\n${QUOTE}\n` +
          "\n" +
          "import json\n" +
          "\n" +
          'with open("model.json", "w") as f:\n' +
          "    f.write(GRAPH)\n" +
          "\n" +
          'print("model:", json.loads(GRAPH)["name"])',
      ),
    ];
  }
  return [
    markdown(
      "## Model\n\nIn the editor, open the **Run** tab and press **Copy graph**.\n" +
        "Paste it between the quotes below, then run every cell in order.",
    ),
    code(
      `GRAPH = r${QUOTE}\n\n${QUOTE}\n` +
        "\n" +
        "import json\n" +
        "\n" +
        "if not GRAPH.strip():\n" +
        '    raise SystemExit("Paste your graph above, then run this cell again.")\n' +
        "\n" +
        'with open("model.json", "w") as f:\n' +
        "    f.write(GRAPH)\n" +
        "\n" +
        'print("model:", json.loads(GRAPH)["name"])',
    ),
  ];
}

export function generateNotebook(input: NotebookInput): string {
  const { target, name } = input;
  const settings = { ...DEFAULTS, ...input.settings };
  const label = LABEL[target];
  const convertFlag = target === "stan" ? " --stan" : "";
  const modelFile = target === "stan" ? "model.stan" : "model.jl";

  const cells: Cell[] = [
    markdown(
      `# ${input.graph ? name : `${label} in Colab`}\n\n` +
        `Fitting a graphical model with **${label}**, through the \`mcmc\` command line tool.\n\n` +
        "Set the model and the sampler below, then run every cell in order. " +
        "The notebook fits the model, checks that it converged, draws the posterior, and " +
        "packages the run so it can be opened in the report app.",
    ),

    ...modelCells(input),

    markdown("## Settings\n\nChange these and run again from here."),
    code(
      `CHAINS = ${settings.n_chains}\n` +
        `DRAWS = ${settings.n_samples}\n` +
        `WARMUP = ${settings.n_adapts}\n` +
        `SEED = ${settings.seed === undefined || settings.seed === null ? "None" : settings.seed}`,
    ),

    markdown(
      `## Install\n\n\`mcmc\` is a self-contained binary. \`mcmc setup\` then installs the ` +
        `${label} toolchain, which takes a few minutes on a fresh Colab runtime.`,
    ),
    code(
      "!curl -fsSL https://mcmcjs.github.io/install.sh | sh\n" +
        "\n" +
        "import os\n" +
        "\n" +
        'os.environ["PATH"] = os.path.expanduser("~/.local/bin") + ":" + os.environ["PATH"]\n' +
        "!mcmc --version",
    ),
    code(`!mcmc setup --engine ${ENGINE[target]}`),

    markdown(`## The ${label} model\n\nWhat the graph becomes as code, and the spec that runs it.`),
    code(`!mcmc convert model.json${convertFlag}\n!cat ${modelFile}`),

    markdown("## Fit\n\n`mcmc run` samples, checks convergence, and records the run."),
    code(
      'seed_flag = f" --seed {SEED}" if SEED is not None else ""\n' +
        "\n" +
        "!mcmc run model.toml --chains {CHAINS} --draws {DRAWS} --warmup {WARMUP}{seed_flag}",
    ),

    markdown(
      "## Did it converge?\n\n" +
        "R-hat near 1 and a healthy effective sample size for every parameter. " +
        "`mcmc diagnose` exits non-zero when it did not, so read this before the posterior.",
    ),
    code("!mcmc summary\n!mcmc diagnose"),

    markdown(
      "## Plots\n\n" +
        "Traces and ranks show the chains mixing, densities and the forest plot show the " +
        "posterior itself.",
    ),
    code(
      "from IPython.display import SVG, display\n" +
        "\n" +
        `for kind in ${JSON.stringify(PLOT_KINDS)}:\n` +
        "    !mcmc plot --kind {kind} --format svg -o {kind}.svg\n" +
        "    print(kind)\n" +
        '    display(SVG(f"{kind}.svg"))',
    ),

    markdown(
      "## Open the run in the report app\n\n" +
        "A run bundle holds the samples, the spec and the diagnostics in one file. " +
        "Download it and drop it into [the report app](https://mcmcjs.github.io/report/) to " +
        "explore every parameter.",
    ),
    code(
      "!mcmc export bundle -o run.mcmcrun.json\n" +
        "\n" +
        "from google.colab import files  # Colab only\n" +
        "\n" +
        'files.download("run.mcmcrun.json")',
    ),
  ];

  const notebook = {
    cells,
    metadata: {
      kernelspec: { display_name: "Python 3", language: "python", name: "python3" },
      language_info: { name: "python" },
      colab: { provenance: [], name },
    },
    nbformat: 4,
    nbformat_minor: 5,
  };
  return `${JSON.stringify(notebook, null, 1)}\n`;
}

/**
 * The Colab URL for a notebook committed to GitHub. Colab fetches it through
 * the GitHub API at the ref given, so the ref has to be one that carries the
 * file: a preview build points at its own branch, a release build at main.
 */
export function colabUrl(repoPath: string, ref = "main", repo = "mcmcjs/mcmcjs"): string {
  return `https://colab.research.google.com/github/${repo}/blob/${ref}/${repoPath}`;
}
