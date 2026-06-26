---
layout: ../../../layouts/DocsLayout.astro
title: Run inference
description: Fit a model from a spec file and produce a samples file.
---

MCMC.js gives you two ways to run inference: `mcmc run` for a zero-config end-to-end workflow, and `mcmc fit` for the explicit spec-in, samples-out contract.

## `mcmc run`: the front door

`mcmc run <input>` runs the whole workflow in one step: it fits, diagnoses, and records the run in the project store.
The input can be any of three things, and the backend is detected from it:

- a model file (`.jl`), a Turing or JuliaBUGS model,
- a spec file (`.toml` / `.json`), or
- a DoodleBUGS graph (`.json`), which is converted first.

```bash
mcmc run model.jl --data data.csv --seed 42
```

It prints the diagnostics table and verdict, and exits `0` on convergence, `2` if it ran but did not converge, or `1` on error.

### Settings: flags over spec

When you run a model file directly, sampling settings come from flags; when you run a spec file, the spec supplies them and flags override.
Flags are always honored.

| Flag | Meaning |
| --- | --- |
| `--data <file>` | data file: `.json` object or `.csv` columns |
| `--draws <n>` | posterior draws (default 1000) |
| `--warmup <n>` | warmup iterations (default 1000) |
| `--chains <n>` | number of chains (default 4) |
| `--adapt-delta <x>` | NUTS target acceptance rate (default 0.8) |
| `--seed <n>` | random seed (default: drawn fresh and recorded) |
| `--backend <id>` | backend, default detected from the model |
| `--entry <name>` | model entry function (default `build_model`) |
| `-o, --out <file>` | also export the samples file to this path |
| `--store <dir>` | run store directory (default: nearest `.mcmc`, or beside the model) |
| `--julia-version <channel>` | Julia version/channel to run, overriding the spec |
| `--package <name=version>` | pin a managed package version, repeatable (e.g. `--package Turing=0.45`) |
| `--json` | print results as JSON |

### Reuse and `--refit`

`mcmc run` records each run in a hidden `.mcmc/` store keyed by the model, data, and settings.
If nothing changed since the last run, it reuses the recorded result instead of refitting:

```
unchanged since run 20260626-050043-61ae20 (just now); reusing (--refit to force)
```

Pass `--refit` to fit again even when nothing changed.
See [The run store](/docs/guides/run-store/) for how runs are recorded and referenced.

### Streaming and the daemon

- `--stream-out <file>` streams sampled draws as NDJSON (one batch per line) to a file, or to stdout with `-`.
- `--daemon` fits through a persistent Julia worker (or set `MCMC_DAEMON=1`), which avoids paying Julia's startup cost on every run. See [Manage Julia](/docs/guides/julia/).
- `--verbose` shows the full raw install/precompile output instead of a collapsed spinner.

## `mcmc fit`: spec in, samples out

`mcmc fit <spec>` is the explicit inference step.
It takes a spec file (TOML or JSON), runs MCMC, and writes a samples file.
It does not diagnose or record a run; it is the composable primitive.

```bash
mcmc fit model.toml -o samples.json
```

| Flag | Meaning |
| --- | --- |
| `-o, --out <path>` | samples output file, or a directory when `--versions` is used |
| `--julia-version <channel>` | Julia version/channel to run, overriding the spec |
| `--versions <list>` | run the spec across several Julia versions (comma-separated) |
| `--package-versions <name=list>` | run across versions of one managed package (e.g. `Turing=0.44,0.45`) |
| `--keep-going` | with a matrix, continue after a failure |
| `--daemon` | fit through a persistent Julia worker |
| `--verbose` | show raw install/precompile output |
| `--json` | print the result as JSON |

The spec format, including `[model]`, `[sampler]`, and inline `[data]`, is documented in [the Spec file reference](/docs/reference/spec/).
The samples file it writes is documented in [the Samples file reference](/docs/reference/samples/).

### Version matrices

`--versions` and `--package-versions` run the same spec across several Julia versions or several versions of one managed package, which is useful for reproducibility checks.
Point `-o` at a directory; each cell writes its own samples file there.

```bash
mcmc fit model.toml --versions 1.11,1.12 -o out/
mcmc fit model.toml --package-versions Turing=0.44,0.45 -o out/
```
