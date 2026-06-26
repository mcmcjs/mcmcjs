---
layout: ../../layouts/DocsLayout.astro
title: Introduction
description: What MCMC.js is and how the command-line workflow fits together.
---

MCMC.js is a thin TypeScript command-line tool that automates the Bayesian workflow over the Julia probabilistic-programming ecosystem.
You write a model in [Turing.jl](https://turinglang.org) or [JuliaBUGS](https://github.com/TuringLang/JuliaBUGS.jl), and the `mcmc` CLI bootstraps Julia, runs the sampler, and turns the result into convergence diagnostics, summary tables, and plots.

The CLI does not reimplement inference.
It orchestrates: it owns argument parsing, spec validation, file I/O, diagnostics, and bootstrapping, and reaches into Julia only to run the model itself.

## One spec in, one samples file out

Every stage shares a single data contract.

- **One declarative spec file in** describes the model, its data, and the sampling configuration. TOML is the primary format; JSON is also accepted.
- **One samples file out** is the canonical output of inference and the canonical input to everything downstream. It is [MCMCChains](https://github.com/TuringLang/MCMCChains.jl) JSON, a cross-ecosystem container for posterior draws plus sampler statistics (divergences, energy, tree depth).

Because the output of one command is a valid input to the next, the commands compose.
Choosing a cross-ecosystem samples format on purpose also insulates MCMC.js from Turing's in-memory chain-type change: the Julia driver requests a stable chain type, and downstream commands never depend on Turing's internal representation.

## The workflow

```
model  ->  infer  ->  diagnose  ->  predict
```

- **Model** in a `.jl` file, a `spec.toml`, or a DoodleBUGS `graph.json`.
- **Infer** with `mcmc run` (zero-config) or `mcmc fit` (spec in, samples out).
- **Diagnose** with `mcmc diagnose` and `mcmc summary`, visualize with `mcmc plot`.
- **Predict** posterior-predictive draws with `mcmc predict`.

## Who it is for

MCMC.js targets humans and AI agents at the same time, which drives two design choices.

- **Structured output.** Every command supports `--json`, so results are machine-parseable.
- **Clear exit codes.** `0` ok, `1` error, `2` ran but a domain check failed (for example, non-convergence). An agent can branch on the exit code without parsing text.

<div class="callout note"><p>MCMC.js is in early alpha. The CLI surface and the file formats are not yet stable.</p></div>

## Next steps

Install the CLI and provision Julia in [Installation](/docs/install/), then fit and diagnose your first model in the [Quickstart](/docs/quickstart/).
