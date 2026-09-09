// A runnable Jupyter notebook for a graph, in the flavour Google Colab opens.
//
// Both targets use the Python kernel, because that is the runtime Colab gives
// you: Stan through cmdstanpy, and JuliaBUGS through juliacall, which installs
// Julia on first use. The JuliaBUGS notebook writes the same script the Script
// download produces and includes it, so there is one Julia code path, not two.

import type { GraphElement } from "../core/types";
import { generateStandaloneScript, type StandaloneGeneratorSettings } from "./bugs-script";
import {
  type CensoredField,
  extractCensoredFields,
  generateStanDataJson,
  generateStanInitsJson,
} from "./stan";

export type NotebookTarget = "juliabugs" | "stan";

export interface NotebookInput {
  target: NotebookTarget;
  /** The graph's name, used for the title and the suggested filename. */
  name: string;
  /** BUGS model code for `juliabugs`, a Stan program for `stan`. */
  modelCode: string;
  data: Record<string, unknown>;
  inits: Record<string, unknown>;
  /** Needed by the Stan target to shape its data and inits. */
  elements?: GraphElement[];
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

/** A Python triple-quoted raw string that cannot be closed early by its content. */
function pyBlock(text: string): string {
  // A raw string cannot end in a backslash, and `'''` would close it early.
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

function juliaCells(input: NotebookInput): Cell[] {
  const script = generateStandaloneScript({
    modelCode: input.modelCode,
    data: input.data,
    inits: input.inits,
    settings: input.settings,
  });
  return [
    markdown(
      `# ${input.name}\n\n` +
        "JuliaBUGS, run from Python through [juliacall](https://juliapy.github.io/PythonCall.jl/).\n\n" +
        "The first cell installs Julia and the model packages. On a fresh Colab runtime that " +
        "takes several minutes; it is cached for the rest of the session.",
    ),
    code(
      "%pip install -q juliacall\n" +
        "\n" +
        "from juliacall import Main as jl\n" +
        "\n" +
        'jl.seval("""\n' +
        "import Pkg\n" +
        'Pkg.add(["JuliaBUGS", "AbstractMCMC", "AdvancedHMC", "ADTypes", "Mooncake", "FlexiChains"])\n' +
        '""")',
    ),
    markdown("## The model\n\nThe graph as a JuliaBUGS script: data, inits, model, sampler."),
    code(
      `script = r${pyBlock(script)}\n\nwith open("run.jl", "w") as f:\n    f.write(script)\n\nprint(script)`,
    ),
    markdown("## Sample\n\nThis runs the script and prints the posterior summary."),
    code('jl.include("run.jl")'),
  ];
}

function stanCells(input: NotebookInput): Cell[] {
  const censored: CensoredField[] = extractCensoredFields(input.elements ?? []);
  const dataJson = generateStanDataJson(input.data, censored);
  const initsJson = generateStanInitsJson(input.inits, input.elements ?? []);
  const { n_samples, n_adapts, n_chains, seed } = input.settings;
  return [
    markdown(
      `# ${input.name}\n\n` +
        "Stan, run with [CmdStanPy](https://mc-stan.org/cmdstanpy/).\n\n" +
        "The first cell installs CmdStan, which compiles a toolchain and takes " +
        "several minutes on a fresh Colab runtime.",
    ),
    code(
      "%pip install -q cmdstanpy\n" +
        "\n" +
        "import cmdstanpy\n" +
        "cmdstanpy.install_cmdstan(progress=True)",
    ),
    markdown("## The model"),
    code(
      `model_code = ${pyBlock(input.modelCode)}\n` +
        "\n" +
        'with open("model.stan", "w") as f:\n' +
        "    f.write(model_code)\n" +
        "\n" +
        "print(model_code)",
    ),
    markdown("## Data and initial values"),
    code(
      "import json\n" +
        "\n" +
        `data = json.loads(r${pyBlock(dataJson)})\n` +
        `inits = json.loads(r${pyBlock(initsJson)})\n` +
        "\n" +
        'with open("data.json", "w") as f:\n' +
        "    json.dump(data, f)\n" +
        'with open("inits.json", "w") as f:\n' +
        "    json.dump(inits, f)\n" +
        "\n" +
        "data",
    ),
    markdown("## Sample"),
    code(
      'model = cmdstanpy.CmdStanModel(stan_file="model.stan")\n' +
        "fit = model.sample(\n" +
        '    data="data.json",\n' +
        '    inits="inits.json",\n' +
        `    chains=${n_chains},\n` +
        `    iter_warmup=${n_adapts},\n` +
        `    iter_sampling=${n_samples},\n` +
        (seed === undefined || seed === null ? "" : `    seed=${seed},\n`) +
        ")",
    ),
    markdown("## Results"),
    code("print(fit.summary())\nprint(fit.diagnose())"),
  ];
}

/** A complete `.ipynb` document, as the JSON text a notebook file holds. */
export function generateNotebook(input: NotebookInput): string {
  const cells = input.target === "stan" ? stanCells(input) : juliaCells(input);
  const notebook = {
    cells,
    metadata: {
      kernelspec: { display_name: "Python 3", language: "python", name: "python3" },
      language_info: { name: "python" },
      colab: { provenance: [] },
    },
    nbformat: 4,
    nbformat_minor: 5,
  };
  return `${JSON.stringify(notebook, null, 1)}\n`;
}

/**
 * The Colab URL for a notebook committed to GitHub. Colab can only open a
 * notebook from GitHub or Drive, never from an arbitrary URL or from memory,
 * so a graph's own notebook is downloaded and uploaded, while this opens a
 * ready-made one.
 */
export function colabUrl(repoPath: string, branch = "main", repo = "mcmcjs/mcmcjs"): string {
  return `https://colab.research.google.com/github/${repo}/blob/${branch}/${repoPath}`;
}
