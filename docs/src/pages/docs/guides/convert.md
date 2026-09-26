---
layout: ../../../layouts/DocsLayout.astro
title: Convert DoodleBUGS
description: Turn a DoodleBUGS graph into a JuliaBUGS model file and a fit-able spec.
---

[DoodleBUGS](https://github.com/TuringLang/DoodleBUGS) lets you draw a Bayesian model as a graph.
`mcmc convert <graph>` turns a saved DoodleBUGS graph into a JuliaBUGS model file plus a fit-able spec, so a drawn model goes straight into the MCMC.js workflow.

```bash
mcmc convert model.json
```

```
wrote /path/to/model.jl
wrote /path/to/model.toml

fit it with: mcmc fit /path/to/model.toml
```

## What it writes

From `graph.json` (without `-o`, the prefix is the graph file name without `.json`):

- **`<prefix>.jl`** — a JuliaBUGS model file. The graph is topologically sorted (Kahn's algorithm) and emitted as classic BUGS `model { ... }` code: plates become `for` loops, stochastic and observed nodes become `~`, deterministic nodes become `<-`. The generated code is wrapped in the `build_model(data)` contract MCMC.js expects, compiling the model with `JuliaBUGS.compile`.
- **`<prefix>.toml`** — a minimal, fit-able spec with `backend.id = "juliabugs"`, pointing at the generated model file, with the data carried over from the graph.

A BUGS model must be a directed acyclic graph; if the graph contains a cycle, `convert` refuses rather than mis-generate.

## Options

| Flag | Meaning |
| --- | --- |
| `-o, --out <prefix>` | output path prefix (default: the graph file without `.json`) |
| `--seed <n>` | seed to write into the spec (default: 1) |
| `--json` | print the result as JSON |

## Then fit it

The generated spec is a normal spec file, so the rest of the workflow is unchanged:

```bash
mcmc fit model.toml -o samples.json
mcmc diagnose samples.json
```

The graph-to-model codegen lives in the `@mcmcjs/doodleppl` package, the single source of truth shared by the DoodlePPL editor and the CLI.
You can also hand the graph directly to `mcmc run model.json`, which converts and fits in one step.

## Draw it as a figure

`mcmc figure <graph>` draws the same graph as a black-and-white figure for a paper, keeping the node positions saved in the graph.
Nodes and plates move only as far as needed so nothing overlaps, and an edge curves around any node or label in its way.
Stochastic nodes are circles, observed nodes are shaded, deterministic nodes are double circles, constants are squares, and plates are boxes labelled with their loop.
Greek names and indices are typeset as maths, so `mu[i]` is drawn as μ with subscript i.

```bash
mcmc figure model.json -o model.tex                 # a tikzpicture to \input into a document
mcmc figure model.json --standalone -o model.tex    # a document pdflatex compiles on its own
mcmc figure model.json --format svg -o model.svg
```

The TikZ picture needs `\usepackage{tikz}` and `\usetikzlibrary{arrows.meta}`.
The DoodlePPL editor offers the same two files in its Export tab.
