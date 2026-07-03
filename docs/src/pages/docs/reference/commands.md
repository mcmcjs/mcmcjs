---
layout: ../../../layouts/DocsLayout.astro
title: CLI commands
description: Reference for every mcmc command and its flags.
---

Every command supports `--json` for structured output and follows the [exit-code contract](/docs/reference/exit-codes/) (`0` ok, `1` error, `2` ran but a domain check failed).
Run `mcmc <command> --help` for the authoritative, current flags.

## Run inference

| Command | Description | Key flags |
| --- | --- | --- |
| `run <input>` | full workflow: fit, diagnose, record a run | `--data`, `--draws`, `--warmup`, `--chains`, `--adapt-delta`, `--seed`, `--backend`, `--entry`, `-o/--out`, `--stream-out`, `--refit`, `--daemon`, `--julia-version`, `--package`, `--store` |
| `fit <spec>` | run MCMC inference, write a samples file | `-o/--out`, `--julia-version`, `--versions`, `--package-versions`, `--keep-going`, `--daemon` |
| `predict <spec> <samples>` | draw posterior-predictive samples | `-o/--out`, `--julia-version`, `--verbose` |

`run` takes a `.jl` or `.stan` model file, a spec, or a DoodleBUGS graph; `fit` and `predict` accept specs for both the Julia backends and Stan.
For Stan, `predict` re-runs the model's `generated quantities` block over the posterior draws.
See [Run inference](/docs/guides/run/) and [Predict](/docs/guides/predict/).

## Inspect runs

| Command | Description | Key flags |
| --- | --- | --- |
| `runs` | list and manage recorded runs (`runs list`, `runs prune --keep <n>`) | `--store` |
| `show [ref]` | show one run's settings and artifacts | `--store` |
| `diagnose [target]` | convergence diagnostics for a samples file | `--rhat-max`, `--ess-min`, `--hdi-prob`, `--max-divergences`, `--warmup`, `--stdin`, `--store` |
| `summary [target]` | posterior summary statistics | `--var`, `--warmup`, `--stdin`, `--store` |
| `samples [target]` | export the raw draws in a portable format | `--to`, `-o/--out`, `--warmup`, `--stdin`, `--store` |
| `plot [target]` | diagnostic plots for a samples file | `--kind`, `--format`, `--var`, `-o/--out`, `--width`, `--height`, `--ascii`, `--hdi-prob`, `--bins`, `--max-lag`, `--color-by`, `--warmup`, `--stdin`, `--store` |
| `export <what>` | copy a run's artifact (`samples`/`spec`/`record`) to a visible file | `--run`, `-o/--out`, `--force`, `--store` |

A `target` is a samples file (MCMCChains JSON or ArviZ InferenceData JSON) or a run ref (`latest`, `@N`, an id prefix); it defaults to the latest store run.
See [Diagnose convergence](/docs/guides/diagnose/), [Plot](/docs/guides/plot/), and [The run store](/docs/guides/run-store/).

## Start a project

| Command | Description | Key flags |
| --- | --- | --- |
| `init [dir]` | seed a directory with a runnable example model and data | `--force`, `--json` |
| `sandbox` | open a throwaway shell seeded with an example model | `--strict`, `--keep`, `--delete`, `--keep-dir`, `--name` |
| `convert <graph>` | DoodleBUGS graph to a model file plus a fit-able spec | `-o/--out`, `--seed` |

`sandbox` is the one interactive command; everything else runs unattended.
See [Convert DoodleBUGS](/docs/guides/convert/).

## Toolchain

| Command | Description | Key flags |
| --- | --- | --- |
| `setup` | install an inference toolchain: Julia via juliaup by default, CmdStan with `--engine stan` | `--engine`, `--stan-version`, `--dry-run`, `--verbose` |
| `doctor` | report every engine's toolchain (or one with `--engine`) | `--engine` |
| `engines` | list known inference engines | |
| `julia version <sub>` | manage installed Julia versions: `list`, `status`, `add`, `remove`, `default`, `update`, `gc` | `--default` (add), `--verbose` |
| `stan version <sub>` | manage installed CmdStan versions: `list`, `status`, `add`, `remove` | `--verbose` (add) |
| `daemon <sub>` | manage persistent Julia workers: `status`, `stop` | |

See [Manage Julia](/docs/guides/julia/).
