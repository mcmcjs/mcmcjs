---
layout: ../../../layouts/DocsLayout.astro
title: Julia driver
description: How the Julia bridge detects, provisions, and drives the runtime.
---

`@mcmcjs/julia` is the bridge to the Julia ecosystem.
It detects and bootstraps the toolchain, manages a pinned managed project, and runs inference as a subprocess implementing the [engine runner contract](/docs/dev/engine/).
It is the one place that touches Julia.

## Toolchain detection and setup

`detectJulia` and `detectJuliaup` locate the installed tools and their versions; `planSetup` and `runSetup` install [juliaup](https://github.com/JuliaLang/juliaup) and Julia when they are missing.
`doctor` rolls these into the `HealthReport` the CLI prints.
This is what `mcmc setup` and `mcmc doctor` call.

## Version management

The version commands wrap juliaup channels: `list`, `add`, `remove`, `default`, `update`, and `gc`.
A channel is a moving target (`release`) or a concrete version (`1.10`); `mcmc julia version` surfaces these directly.

## The managed project

Inference does not run in your global Julia environment.
The bridge provisions an isolated, per-user managed project (a `Project.toml` plus a resolved `Manifest.toml`) holding the packages a fit needs: Turing, FlexiChains, DimensionalData, MCMCChains, JuliaBUGS, AdvancedHMC, ForwardDiff, Mooncake, JSON, and StableRNGs.
`ensureProject` provisions and precompiles it.

The managed project directory is keyed by the concrete Julia version and by any package pins, so each version resolves its own compatible Manifest and each distinct set of pins gets its own environment.
This is why `mcmc fit --versions` and `--package-versions` can compare versions without one Manifest interfering with another.
Package pins are validated against the managed set, and version strings are sanitized before they are interpolated into generated Julia source.

## The driver process contract

The `fit` and `predict` runners invoke `driver.jl`, a one-shot driver:

- It reads a run-request JSON file (the resolved spec plus data) given as its argument and runs it through the fit library's request handler.
- On success it prints a single line of provenance JSON to stdout (the resolved package versions and run metadata) and writes the MCMCChains-JSON samples file.
- On failure it prints one-line JSON to stderr (`{ error, stage }`) and exits nonzero.
- Progress streams to stderr as `{"mcmcjs":"progress"}` lines, which the `FitRunner` parses into `FitProgress` callbacks; sampled draws stream as NDJSON batches for `--stream-out`.

The driver requests a stable chain type and converts whatever the sampler returns, so Turing's in-memory chain-type change is absorbed here and never reaches the rest of the system.

## Persistent workers

For repeated fits, `worker.ts` keeps a Julia process warm behind a socket so a fit skips Julia's startup and load cost.
This is the `--daemon` path and the `mcmc daemon` group; see [Manage Julia](/docs/guides/julia/).
