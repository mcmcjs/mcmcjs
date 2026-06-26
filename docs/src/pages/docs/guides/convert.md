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

The graph-to-model codegen lives in the `@mcmcjs/doodlebugs` package, the single source of truth shared by the DoodleBUGS editor and the CLI.
You can also hand the graph directly to `mcmc run model.json`, which converts and fits in one step.
