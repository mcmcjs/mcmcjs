---
layout: ../../../layouts/DocsLayout.astro
title: The run store
description: Record, list, inspect, and export runs from the project-local store.
---

`mcmc run` records every fit in a project-local store so you can revisit, compare, and export results without refitting.
The store is a hidden `.mcmc/` directory, found by walking up from the current directory (or created beside the model on the first run).

## What a run records

Each run keeps its own directory under `.mcmc/runs/<id>/` containing the samples file, the run record, the frozen spec, and a snapshot of the model:

```
.mcmc/runs/20260626-050043-61ae20/
  samples.json   # the posterior draws
  run.json       # the RunRecord: seed, backend, packages, hashes, timing
  spec.toml      # the effective spec used for the fit
  model.jl       # a snapshot of the model that was run
```

A ledger tracks all runs and their diagnostics summary.
A run is keyed by the model, data, and settings, so an unchanged input reuses the recorded run instead of refitting (pass `--refit` to force a fresh fit).

## Listing runs

```bash
mcmc runs list
```

```
ref  run                     model     sampler  seed  verdict    div  when      took
---  ----------------------  --------  -------  ----  ---------  ---  --------  -----
@1   20260626-050043-61ae20  model.jl  1000x4   42    converged  0    just now  21.3s
```

`mcmc runs prune --keep <n>` deletes old runs, keeping the most recent ones.

## Run references

Commands that read a run (`show`, `export`, `diagnose`, `summary`, `samples`, `plot`) accept a run ref in three forms:

- `latest` — the most recent run (the default).
- `@N` — the Nth most recent run (`@1` is latest).
- an id prefix — the start of a run id, for example `20260626`.

## Inspecting a run

`mcmc show [ref]` prints one run's settings, provenance, and artifact paths.

```bash
mcmc show
```

```
run 20260626-050043-61ae20
model     model.jl (sha256 08bf6f6145a3)
backend   turing on Julia 1.12.6 (ran 1.12.6)
sampler   NUTS, 4 chains x 1000 draws + 1000 warmup, adapt_delta 0.8, seed 42
data      sha256 1c34409a8f88
status    ok, converged (R-hat max 1.006, ESS bulk min 1277, divergences 0)
started   2026-06-26T05:00:43.983Z (just now, 21.3 s)
packages  ADTypes 1.22.0, ... MCMCChains 7.7.0, Turing 0.45.0
artifacts .mcmc/runs/20260626-050043-61ae20/samples.json
          .mcmc/runs/20260626-050043-61ae20/run.json
          .mcmc/runs/20260626-050043-61ae20/spec.toml
          .mcmc/runs/20260626-050043-61ae20/model.jl
```

The recorded package versions and input hashes make a run reproducible and auditable.

## Exporting an artifact

`mcmc export <what>` copies a run's artifact out of the store into a visible file.
`what` is one of `samples`, `spec`, or `record`.

```bash
mcmc export samples --run latest -o samples.json
```

| Flag | Meaning |
| --- | --- |
| `--run <ref>` | run ref: `latest` (default), `@N`, or an id prefix |
| `-o, --out <path>` | output path (default: derived from the model name) |
| `--force` | overwrite an existing file |
| `--store <dir>` | run store directory |
| `--json` | print the result as JSON |

<div class="callout note"><p>Every store-reading command takes <code>--store &lt;dir&gt;</code> to point at a specific <code>.mcmc/</code> directory. By default they use the nearest one above the current directory.</p></div>
