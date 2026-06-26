---
layout: ../../../layouts/DocsLayout.astro
title: Architecture
description: How the CLI orchestrator and the Julia inference engine fit together.
---

MCMC.js is a thin TypeScript orchestrator over a Julia subprocess.
The orchestrator owns everything that does not strictly require a probabilistic-programming runtime; it reaches into Julia only to run the model itself.

## A thin orchestrator

The TypeScript side, running on Node.js (>= 22), owns argument parsing, spec validation, file I/O, diagnostics, plotting, the run store, environment bootstrap, and end-to-end command sequencing.
This keeps the surface that humans and agents interact with fast, portable, and dependency-light.

## The Julia subprocess boundary

Only inference needs the live model, so only inference enters Julia.
Four commands touch Julia: `setup` (provision the toolchain), `fit` and `predict` (run the model), and `run` (which sequences a `fit`).

Everything else is pure TypeScript and never starts a Julia process: `diagnose`, `summary`, `samples`, `plot`, `convert`, `doctor`, `engines`, the `runs`/`show`/`export` store commands, and the `julia version` management group.
Those commands operate on files, not on live models, so they have no reason to pay Julia's startup or installation cost.

This split is the central design decision.
It also explains why the orchestrator lives outside Julia: a bootstrapping tool cannot be written in the runtime it bootstraps, because it must be able to install Julia on a machine that has none.

When inference does run, the TypeScript side calls Julia through `node:child_process` `execFile` (no shell), crossing a single, narrow boundary.

## Spec in, samples out

The whole system is organized around two file contracts.

```
spec file (TOML/JSON)  ->  [ fit / predict in Julia ]  ->  samples file (MCMCChains JSON)
                                                              |
                       [ diagnose / summary / plot in TS ] <-+
```

- The [spec file](/docs/reference/spec/) declares the model, data, and sampler. It is validated with zod and carries a `schema_version`.
- The [samples file](/docs/reference/samples/) is MCMCChains JSON, capturing draws plus sampler statistics. Alongside it, a fit writes a run record (its own `schema_version`) capturing the spec hash, seed, backend, resolved Julia and package versions, and provenance hashes.

Because the output of one stage is the input to the next, the commands compose.

## Insulation from the chain-type change

Turing.jl is changing its default in-memory chain type.
MCMC.js defines its on-disk contract as a cross-ecosystem standard, not a Turing-internal type dumped to disk: the Julia driver requests a stable chain type and converts whatever the sampler returns.
The conversion happens in exactly one place, inside the Julia bridge, so the chain-type change is absorbed there and never reaches the diagnostics, plotting, or CLI layers.

## Where to go next

- The package map: [Packages](/docs/dev/packages/).
- The pluggable engine contract: [Engine contract](/docs/dev/engine/).
- The Julia bridge and driver: [Julia driver](/docs/dev/julia/).
- The plotting stack: [Plotting internals](/docs/dev/plotting/).
