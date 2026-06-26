---
layout: ../../layouts/DocsLayout.astro
title: Installation
description: Install the mcmc CLI and provision the Julia runtime.
---

MCMC.js ships as the `mcmcjs` npm package, which installs the `mcmc` binary.
Inference runs in Julia, which the CLI can install for you.

## 1. Install the CLI

You need [Node.js](https://nodejs.org) 22 or newer.

```bash
npm install -g mcmcjs
```

This puts the `mcmc` binary on your `PATH`.
Check it:

```bash
mcmc --version
```

## 2. Provision Julia

Inference needs Julia and a managed set of packages (Turing.jl, JuliaBUGS, and friends).
`mcmc setup` installs the toolchain through [juliaup](https://github.com/JuliaLang/juliaup) and precompiles the managed project, so you do not configure Julia by hand.

```bash
mcmc setup
```

Pass `--dry-run` to see what would be installed without making changes, or `--verbose` to see the full install and precompile output instead of a collapsed spinner.

<div class="callout note"><p>The first <code>setup</code> downloads and precompiles a Julia project, which takes a few minutes. After that, fits start fast.</p></div>

## 3. Verify

`mcmc doctor` reports the toolchain MCMC.js needs and tells you whether you are ready to fit.

```bash
mcmc doctor
```

```
juliaup  1.20.7  /home/you/.juliaup/bin/juliaup
julia    1.12.6  /home/you/.juliaup/bin/julia

ready for inference
```

Add `--json` for a machine-readable report, or `--engine <id>` to check a specific engine.

## Libraries

The CLI is the unscoped `mcmcjs` package.
The internal libraries it is built from publish under the `@mcmcjs/*` scope (for example `@mcmcjs/core` and `@mcmcjs/diagnostics`).
You do not need to install those directly to use the CLI; see [Packages](/docs/dev/packages/) if you want to build on them.

## Next steps

Fit and diagnose your first model in the [Quickstart](/docs/quickstart/).
