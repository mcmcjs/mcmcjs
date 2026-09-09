// A runnable Jupyter notebook for a graph, in the flavour Google Colab opens.
//
// The notebook's input is the graph document itself, and every step is the
// mcmc CLI: convert, run, summary, diagnose, plot, export. That is one code
// path for both backends rather than a hand-written cmdstanpy script beside a
// hand-written Julia one, and it is the same workflow the CLI gives you
// locally, so the notebook cannot drift from the tool it demonstrates.
//
// Cells run on the Python kernel, which is what Colab provides; the CLI is a
// self-contained binary, so nothing needs Node.

import type { UnifiedModelData } from "../core/types";
import type { StandaloneGeneratorSettings } from "./bugs-script";

export type NotebookTarget = "juliabugs" | "stan";

export interface NotebookInput {
  target: NotebookTarget;
  /** The graph's name, used for the title and the suggested filename. */
  name: string;
  /** The graph document the notebook fits: the notebook's only input. */
  graph: UnifiedModelData;
  settings: StandaloneGeneratorSettings;
}

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

/** A Python triple-quoted raw string that its own content cannot close early. */
function pyBlock(text: string): string {
  return `'''\n${text.replace(/\\/g, "\\\\").replace(/'''/g, "\\'\\'\\'")}\n'''`;
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

/** The plots the notebook draws, chosen to cover convergence and shape. */
const PLOT_KINDS = ["trace", "density", "forest", "rank"];

export function generateNotebook(input: NotebookInput): string {
  const { target, name, settings } = input;
  const label = LABEL[target];
  const convertFlag = target === "stan" ? " --stan" : "";
  const seedFlag =
    settings.seed === undefined || settings.seed === null ? "" : ` --seed ${settings.seed}`;

  const cells: Cell[] = [
    markdown(
      `# ${name}\n\n` +
        `Fitting this model with **${label}**, through the \`mcmc\` command line tool.\n\n` +
        "Every step below is one command: convert the graph to a model, fit it, check that it " +
        "converged, draw the posterior, and package the run so it can be opened in the report app. " +
        "Run the cells in order.",
    ),

    markdown(
      "## Install\n\n" +
        `\`mcmc\` is a self-contained binary. \`mcmc setup\` then installs the ${label} toolchain, ` +
        "which on a fresh Colab runtime takes several minutes.",
    ),
    code(
      "!curl -fsSL https://mcmcjs.github.io/install.sh | sh\n" +
        'import os\n\nos.environ["PATH"] = os.path.expanduser("~/.local/bin") + ":" + os.environ["PATH"]\n' +
        "!mcmc --version",
    ),
    code(`!mcmc setup --engine ${ENGINE[target]}`),

    markdown(
      "## The graph\n\n" +
        "The model as it was drawn, with its data and initial values. Everything below is " +
        "derived from this one document.\n\n" +
        "**To run your own model instead:** in the editor's Run tab press **Copy graph**, then " +
        "replace the JSON below with what you copied. Nothing else in the notebook changes.",
    ),
    code(
      "# Replace this with your own graph: editor -> Run tab -> Copy graph.\n" +
        `graph = r${pyBlock(JSON.stringify(input.graph, null, 2))}\n` +
        "\n" +
        'with open("model.json", "w") as f:\n' +
        "    f.write(graph)\n" +
        "\n" +
        "import json\n" +
        "\n" +
        'print(json.loads(graph).get("name", "model"), "written to model.json")',
    ),

    markdown(
      `## The ${label} model\n\nWhat the graph becomes as code, plus the spec that runs it.`,
    ),
    code(`!mcmc convert model.json${convertFlag}\n!cat model.${target === "stan" ? "stan" : "jl"}`),

    markdown(
      "## Fit\n\n" +
        "`mcmc run` does the whole workflow: it samples, checks convergence, and records the run " +
        "so the later commands can find it.",
    ),
    code(
      "!mcmc run model.toml" +
        ` --chains ${settings.n_chains}` +
        ` --draws ${settings.n_samples}` +
        ` --warmup ${settings.n_adapts}` +
        seedFlag,
    ),

    markdown(
      "## Did it converge?\n\n" +
        "R-hat near 1 and a healthy effective sample size per parameter. `mcmc diagnose` exits " +
        "non-zero if it did not, so this is the cell to trust before reading the posterior.",
    ),
    code("!mcmc summary\n!mcmc diagnose"),

    markdown(
      "## Plots\n\n" +
        "Traces and ranks show the chains mixing; densities and the forest plot show the " +
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
        "A run bundle holds the samples, the spec and the diagnostics in one file. Download it, " +
        "then drop it into [the report app](https://mcmcjs.github.io/report/) to explore every " +
        "parameter interactively.",
    ),
    code(
      "!mcmc export bundle -o run.mcmcrun.json\n" +
        "\n" +
        "from google.colab import files  # skip this line outside Colab\n" +
        '\nfiles.download("run.mcmcrun.json")',
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
