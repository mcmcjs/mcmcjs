---
layout: ../../../layouts/DocsLayout.astro
title: Packages
description: The pnpm workspace and the nine packages that make up MCMC.js.
---

MCMC.js is a pnpm workspace monorepo.
The CLI is the unscoped `mcmcjs` package; the libraries it is built from publish under the `@mcmcjs/*` scope.

```
packages/
  cli/          -> mcmcjs              (the CLI; bin: mcmc)
  core/         -> @mcmcjs/core
  diagnostics/  -> @mcmcjs/diagnostics
  engine/       -> @mcmcjs/engine
  julia/        -> @mcmcjs/julia
  charts/       -> @mcmcjs/charts
  plots/        -> @mcmcjs/plots
  plots-gl/     -> @mcmcjs/plots-gl
  doodlebugs/   -> @mcmcjs/doodlebugs
```

## The packages

**`mcmcjs` (CLI).**
A thin TypeScript orchestrator that bootstraps Julia, runs inference as a subprocess, and turns the result into diagnostics and plots.
It owns argument parsing, the run store, and command sequencing, and exposes everything through the `mcmc` binary.

**`@mcmcjs/core`.**
The shared data substrate.
It defines the in-memory `Samples` model (chain-major draws plus sampler statistics) and the readers and writers around it: `parseSamples` (auto-detecting MCMCChains JSON, ArviZ InferenceData JSON, and Turing CSV), the Stan CSV readers, the spec parser (`parseSpec`, zod-validated), and the project-local `.mcmc/` run store (records, ledger, and run-ref resolution).

**`@mcmcjs/diagnostics`.**
Dependency-free MCMC convergence diagnostics over plain arrays of chains, following Vehtari et al. (2021): rank-normalized split-R-hat, bulk and tail ESS, MCSE, the Geweke z-diagnostic, HDI and other summaries, autocorrelation and correlation, divergence counting, and the `diagnoseChains` / `isConverged` verdict.

**`@mcmcjs/engine`.**
The runtime and PPL engine contract: a small, dependency-free set of types (`Engine`, `EngineCapabilities`, `HealthReport`, `RuntimeVersion`), a static registry, and the shared subprocess-runner types.
It lets each runtime plug in as a composable unit. See [Engine contract](/docs/dev/engine/).

**`@mcmcjs/julia`.**
The bridge to the Julia ecosystem: toolchain detection and bootstrap via juliaup, juliaup version management, a pinned per-user managed Julia project, and the `driver.jl` that runs Turing or JuliaBUGS and writes the samples file. See [Julia driver](/docs/dev/julia/).

**`@mcmcjs/charts`.**
A small, dependency-free plotting engine that renders a renderer-agnostic figure model to the terminal (Unicode braille/blocks, ASCII fallback) and to headless SVG.
It is domain-neutral: scales, axes, frames, and primitives, with no MCMC knowledge.
A separate browser-only `@mcmcjs/charts/dom` subpath mounts an interactive uPlot chart.

**`@mcmcjs/plots`.**
MCMC diagnostic plots built on `@mcmcjs/charts`.
Split into a data layer (each `*Data` builder turns `Samples` into a serializable object) and renderers (terminal, SVG, and a self-contained interactive HTML page via `buildHtmlDocument`). See [Plotting internals](/docs/dev/plotting/).

**`@mcmcjs/plots-gl`.**
Interactive WebGL renderers (3D point cloud, scatter-plot matrix, parallel coordinates) backed by `regl`, an optional peer dependency.
It consumes data built by `@mcmcjs/plots`, so the terminal, SVG, and HTML backends never pull in WebGL.

**`@mcmcjs/doodlebugs`.**
Framework-free code generation from DoodleBUGS graphs to BUGS / JuliaBUGS model code: parse a saved graph, topologically order it, emit `model { ... }` code, and validate for issues such as cycles.
It is the single source of truth shared by the DoodleBUGS editor and the CLI's `convert`.

## Conventions

Folder names are short (`cli`, `core`); published names are scoped, except the CLI.
New packages mirror an existing package's config.
Each package is versioned independently with [Changesets](https://github.com/changesets/changesets) starting at `0.x`, and ships build artifacts only (`dist/` plus type declarations).
