// A runnable Jupyter notebook for a graph, in the flavour Google Colab opens.
//
// The notebook's input is the graph document and every step is the mcmc CLI:
// convert, run, summary, diagnose, plot, export. That is one workflow for both
// backends, and the same one the CLI gives you locally, so the notebook cannot
// drift from the tool it demonstrates.
//
// A Stan notebook runs on the Python kernel and a JuliaBUGS one on the Julia
// kernel, both runtimes Colab provides. The CLI is a self-contained binary, so
// neither needs Node.

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

// Four chains, as Stan and `mcmc fit` default to: one chain has no R-hat, so
// `mcmc diagnose` can never pass it, and two leave R-hat noisy enough that a
// well-mixed model with hundreds of variables can land one just over 1.01.
const DEFAULTS: NotebookSettings = { n_samples: 1000, n_adapts: 1000, n_chains: 4, seed: 42 };

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

/**
 * A graph as JSON that is safe inside a Julia `raw"""..."""` string.
 *
 * A raw string keeps every character except that it halves a run of
 * backslashes in front of a quote, which would turn the JSON's `\"` into `"`.
 * Doubling each such run undoes that. JSON never has three quotes in a row, so
 * nothing inside can close the block.
 */
export function graphJsonForJulia(graph: unknown): string {
  return JSON.stringify(graph, null, 2).replace(/\\+(?=")/g, (run) => run + run);
}

/** The graph as the notebook for `target` embeds it, and so as Copy graph copies it. */
export function graphJsonForNotebook(graph: unknown, target: NotebookTarget): string {
  return target === "stan" ? graphJsonForPython(graph) : graphJsonForJulia(graph);
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

/** The plots the notebook draws, covering both convergence and shape. */
const PLOT_KINDS = ["trace", "density", "forest", "rank"];

/** The code cells, in the language of the kernel the notebook runs on. */
interface KernelCode {
  metadata: Record<string, unknown>;
  /** The cell that writes the embedded or pasted graph to model.json. */
  model: (graph: string | undefined) => string;
  settings: (s: NotebookSettings) => string;
  install: string;
  setup: string;
  convert: string;
  fit: string;
  check: string;
  plots: string;
  bundle: string;
  /** How to get the bundle out of Colab once it is written. */
  download: string;
}

const PYTHON_QUOTE = "'".repeat(3);

const PYTHON: KernelCode = {
  metadata: {
    kernelspec: { display_name: "Python 3", language: "python", name: "python3" },
    language_info: { name: "python" },
  },
  model: (graph) =>
    `GRAPH = r${PYTHON_QUOTE}\n${graph ?? ""}\n${PYTHON_QUOTE}\n` +
    "\n" +
    "import json\n" +
    "\n" +
    (graph === undefined
      ? "if not GRAPH.strip():\n" +
        '    raise SystemExit("Paste your graph above, then run this cell again.")\n' +
        "\n"
      : "") +
    'with open("model.json", "w") as f:\n' +
    "    f.write(GRAPH)\n" +
    "\n" +
    'print("model:", json.loads(GRAPH)["name"])',
  settings: (s) =>
    `CHAINS = ${s.n_chains}\n` +
    `DRAWS = ${s.n_samples}\n` +
    `WARMUP = ${s.n_adapts}\n` +
    `SEED = ${s.seed === undefined || s.seed === null ? "None" : s.seed}`,
  install:
    "!curl -fsSL https://mcmcjs.github.io/install.sh | sh\n" +
    "\n" +
    "import os\n" +
    "\n" +
    'os.environ["PATH"] = os.path.expanduser("~/.local/bin") + ":" + os.environ["PATH"]\n' +
    "!mcmc --version",
  setup: "!mcmc setup --engine stan",
  convert: "!mcmc convert model.json --stan\n!cat model.stan",
  fit:
    'seed_flag = f" --seed {SEED}" if SEED is not None else ""\n' +
    "\n" +
    "!mcmc run model.toml --chains {CHAINS} --draws {DRAWS} --warmup {WARMUP}{seed_flag}",
  check: "!mcmc summary\n!mcmc diagnose",
  plots:
    "from IPython.display import SVG, display\n" +
    "\n" +
    `for kind in ${JSON.stringify(PLOT_KINDS)}:\n` +
    "    !mcmc plot --kind {kind} --format svg -o {kind}.svg\n" +
    "    print(kind)\n" +
    '    display(SVG(f"{kind}.svg"))',
  bundle:
    "!mcmc export bundle -o run.mcmcrun.json\n" +
    "\n" +
    "from google.colab import files  # Colab only\n" +
    "\n" +
    'files.download("run.mcmcrun.json")',
  download: "Download it",
};

// Colab opens its Julia runtime only for a kernelspec named exactly `julia`, and
// a versioned name such as `julia-1.12` falls back to Python.
const JULIA: KernelCode = {
  metadata: {
    kernelspec: { display_name: "Julia", language: "julia", name: "julia" },
    language_info: { name: "julia", file_extension: ".jl", mimetype: "application/julia" },
  },
  model: (graph) =>
    `GRAPH = raw"""\n${graph ?? ""}\n"""\n` +
    "\n" +
    (graph === undefined
      ? 'isempty(strip(GRAPH)) && error("Paste your graph above, then run this cell again.")\n\n'
      : "") +
    'write("model.json", GRAPH)\n' +
    "\n" +
    'name = match(r"\\"name\\": \\"(.*?)\\"", GRAPH)\n' +
    'println("model: ", name === nothing ? "unnamed" : name[1])',
  settings: (s) =>
    `CHAINS = ${s.n_chains}\n` +
    `DRAWS = ${s.n_samples}\n` +
    `WARMUP = ${s.n_adapts}\n` +
    `SEED = ${s.seed === undefined || s.seed === null ? "nothing" : s.seed}`,
  install:
    "run(pipeline(`curl -fsSL https://mcmcjs.github.io/install.sh`, `sh`))\n" +
    "\n" +
    'ENV["PATH"] = joinpath(homedir(), ".local", "bin") * ":" * ENV["PATH"]\n' +
    "run(`mcmc --version`);",
  setup: "run(`mcmc setup --engine julia`);",
  convert: 'run(`mcmc convert model.json`)\nprint(read("model.jl", String))',
  fit:
    'seed = SEED === nothing ? String[] : ["--seed", string(SEED)]\n' +
    "\n" +
    "# A run that did not converge exits 2, which the next cells report on rather than stop at.\n" +
    "run(ignorestatus(`mcmc run model.toml --chains $CHAINS --draws $DRAWS --warmup $WARMUP $seed`));",
  check: "run(`mcmc summary`)\nrun(ignorestatus(`mcmc diagnose`));",
  plots:
    `for kind in ${JSON.stringify(PLOT_KINDS)}\n` +
    "    run(`mcmc plot --kind $kind --format svg -o $kind.svg`)\n" +
    "    println(kind)\n" +
    '    display("image/svg+xml", read("$kind.svg", String))\n' +
    "end",
  bundle: "run(`mcmc export bundle -o run.mcmcrun.json`);",
  download: "Download it from the Files panel on the left",
};

const KERNEL: Record<NotebookTarget, KernelCode> = { stan: PYTHON, juliabugs: JULIA };

function modelMarkdown(embedded: boolean): string {
  return embedded
    ? "## Model\n\nThe graph as it was drawn, with its data and initial values.\n\n" +
        "To fit a different one, press **Copy graph** in the editor's Run tab and replace the " +
        "JSON below."
    : "## Model\n\nIn the editor, open the **Run** tab and press **Copy graph**.\n" +
        "Paste it between the quotes below, then run every cell in order.";
}

export function generateNotebook(input: NotebookInput): string {
  const { target, name } = input;
  const settings = { ...DEFAULTS, ...input.settings };
  const label = LABEL[target];
  const kernel = KERNEL[target];
  const graph = input.graph ? graphJsonForNotebook(input.graph, target) : undefined;

  const cells: Cell[] = [
    markdown(
      `# ${input.graph ? name : `${label} in Colab`}\n\n` +
        `Fitting a graphical model with **${label}**, through the \`mcmc\` command line tool.\n\n` +
        "Set the model and the sampler below, then run every cell in order. " +
        "The notebook fits the model, checks that it converged, draws the posterior, and " +
        "packages the run so it can be opened in the report app.",
    ),

    markdown(modelMarkdown(input.graph !== undefined)),
    code(kernel.model(graph)),

    markdown("## Settings\n\nChange these and run again from here."),
    code(kernel.settings(settings)),

    markdown(
      `## Install\n\n\`mcmc\` is a self-contained binary. \`mcmc setup\` then installs the ` +
        `${label} toolchain, which takes a few minutes on a fresh Colab runtime.`,
    ),
    code(kernel.install),
    code(kernel.setup),

    markdown(`## The ${label} model\n\nWhat the graph becomes as code, and the spec that runs it.`),
    code(kernel.convert),

    markdown("## Fit\n\n`mcmc run` samples, checks convergence, and records the run."),
    code(kernel.fit),

    markdown(
      "## Did it converge?\n\n" +
        "R-hat near 1 and a healthy effective sample size for every parameter. " +
        "`mcmc diagnose` exits non-zero when it did not, so read this before the posterior.",
    ),
    code(kernel.check),

    markdown(
      "## Plots\n\n" +
        "Traces and ranks show the chains mixing, densities and the forest plot show the " +
        "posterior itself.",
    ),
    code(kernel.plots),

    markdown(
      "## Open the run in the report app\n\n" +
        "A run bundle holds the samples, the spec and the diagnostics in one file. " +
        `${kernel.download} and drop it into [the report app](https://mcmcjs.github.io/report/) ` +
        "to explore every parameter.",
    ),
    code(kernel.bundle),
  ];

  const notebook = {
    cells,
    metadata: { ...kernel.metadata, colab: { provenance: [], name } },
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
