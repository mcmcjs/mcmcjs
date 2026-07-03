---
layout: ../../../layouts/DocsLayout.astro
title: Stan engine
description: How the Stan engine resolves CmdStan, compiles models, and streams draws.
---

`@mcmcjs/stan` is the native Stan engine.
It resolves a local CmdStan install, compiles models through CmdStan's make, and runs sampling as one subprocess per chain, implementing the [engine runner contract](/docs/dev/engine/).
The `stan` backend id runs on the `cmdstan` runtime, and this package is the one place that touches CmdStan.

## CmdStan resolution

`resolveCmdStan` picks the install a fit runs on.
An explicit `MCMCJS_CMDSTAN` (or `CMDSTAN`) home wins outright; otherwise the managed root (`$XDG_DATA_HOME/mcmcjs/stan`, defaulting to `~/.local/share/mcmcjs/stan`) and the conventional `~/.cmdstan` shared with other Stan interfaces are scanned for `cmdstan-<version>` directories, sorted newest first.
The spec's default `installed` channel resolves to the newest install; a concrete version must match exactly.

The version commands build on the same scan: `list` reports the installs newest first, `add` runs a setup for that version, and `remove` deletes only installs under the managed root, never a `~/.cmdstan` or env-var home.

## Setup

`planSetup` and `runSetup` provision the toolchain in ordered steps: report a missing make or C++ compiler (system package managers vary too much to script), download the CmdStan release tarball, and run `make build`.
The download extracts into a staging directory and moves into place atomically, so a partial download is never mistaken for an install on the next run.
The build step is idempotent (a partially built install resumes), and the presence of `bin/stansummary`, one of the last artifacts, marks a completed build.
This is what `mcmc setup --engine stan` calls; it is POSIX-only today.

## The compile cache

`compileModel` compiles a model to an executable through CmdStan's make, cached under `<managed>/models`.
The cache key is a hash of the CmdStan version and the model source with every `#include` resolved and inlined (a few levels deep), so include edits invalidate the cache too.
A `.ok` sentinel is written only after a successful make, so an interrupted compile is never reused as a valid binary.

## Sampling: one process per chain

`runFit` spawns one CmdStan process per chain, in parallel, all sharing the spec's seed with `id=<chain>` varying the stream.
Each process's stdout is parsed line by line for CmdStan's `Iteration: n / total` progress lines, which become the `FitProgress` callbacks.
For `--stream-out`, each chain's growing CSV is tailed on a poll timer: comment lines are skipped, sampler-stat columns are renamed to the shared samples vocabulary, and completed rows are batched into `DrawBatch` messages.

When all chains exit cleanly, the per-chain CSVs go through `fromStanCSVFiles` in `@mcmcjs/core` and are written as the MCMCChains-JSON samples file, alongside a run record carrying the resolved CmdStan version and provenance hashes.

## Predict: generate_quantities

`runPredict` drives CmdStan's `generate_quantities`, which re-runs the model's `generated quantities` block once per posterior draw.
CmdStan needs the fitted parameters as Stan CSV, so `fittedParamsCsv` reconstructs one per chain from the samples file; `generate_quantities` reads parameters by header name and ignores extra columns, so a header plus the parameter draws is sufficient.
The output columns matching `[predict].targets` are filtered into the predictive samples file.
Unlike the Julia engines, targets are not blanked from the data; the generated quantities block reads the data as-is.
