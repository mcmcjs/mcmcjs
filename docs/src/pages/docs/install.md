---
layout: ../../layouts/DocsLayout.astro
title: Installation
description: Install the mcmc CLI and provision the Julia runtime.
---

MCMC.js installs the `mcmc` command either as a single-file binary or from npm.
Inference runs in a backend runtime (Julia, or CmdStan for Stan), which the CLI can install for you.

## 1. Install the CLI

### Without Node.js

The install script downloads one self-contained binary for your platform (macOS and Linux, x64 and arm64) and needs neither Node.js nor npm.

```bash
curl -fsSL https://mcmcjs.github.io/mcmcjs/install.sh | sh
```

It lands in `~/.local/bin` by default; set `MCMC_INSTALL_DIR` to choose somewhere else, or `MCMC_VERSION` to pin a release.
The script verifies the download against the release checksums and tells you if `~/.local/bin` is not on your `PATH`.
Upgrade by running it again.

### With npm

You need [Node.js](https://nodejs.org) 22 or newer.

```bash
npm install -g mcmcjs
```

Either way, check it:

```bash
mcmc --version
```

<div class="callout note"><p>Installing both ways leaves two copies of <code>mcmc</code>, and whichever comes first on your <code>PATH</code> wins. The install script says so when it finds an existing copy, and <code>mcmc doctor</code> names the one that is running and warns about the other.</p></div>

If your shell still runs an older copy after installing, it has cached the old location: run `hash -r`, or open a new shell.

### Uninstall

```bash
curl -fsSL https://mcmcjs.github.io/mcmcjs/uninstall.sh | sh
```

That stops the report server and removes the binary, keeping the cached Julia driver in case you reinstall; pass `--all` to remove that and the report server's state too.
Your runs are never touched, since they live in each project's `.mcmc` directory, and neither are Julia or CmdStan.
A copy installed with npm is reported rather than removed: take that one out with `npm rm -g mcmcjs`.

## 2. Provision Julia

Inference needs Julia and a managed set of packages (Turing.jl, JuliaBUGS, and friends).
`mcmc setup` installs the toolchain through [juliaup](https://github.com/JuliaLang/juliaup) and precompiles the managed project, so you do not configure Julia by hand.

```bash
mcmc setup
```

Pass `--dry-run` to see what would be installed without making changes, or `--verbose` to see the full install and precompile output instead of a collapsed spinner.

<div class="callout note"><p>The first <code>setup</code> downloads and precompiles a Julia project, which takes a few minutes. After that, fits start fast.</p></div>

## 3. Verify

`mcmc doctor` reports every engine's toolchain and tells you whether you are ready to fit.

```bash
mcmc doctor
```

```
Julia
juliaup  1.20.7  /home/you/.juliaup/bin/juliaup
julia    1.12.6  /home/you/.juliaup/bin/julia
ready for inference

Stan (CmdStan)
cmdstan  2.39.0  /home/you/.cmdstan/cmdstan-2.39.0
stanc    2.39.0  /home/you/.cmdstan/cmdstan-2.39.0/bin/stanc
make     4.4.1  make
c++      16.1.1  g++
ready for inference
```

The exit code is 0 as long as at least one engine is ready.
Add `--json` for a machine-readable report, or `--engine <id>` to check one engine in the original flat format.

## Stan (optional)

Stan models run through a local [CmdStan](https://mc-stan.org/users/interfaces/cmdstan), which `mcmc setup` can download and build for you.

```bash
mcmc setup --engine stan
```

Building CmdStan uses `make` and a C++ compiler (`g++` or `clang++`) from your system; Linux and macOS are supported today.
Pass `--stan-version <v>` to install a specific CmdStan release instead of the pinned default.
Check readiness the same way as for Julia:

```bash
mcmc doctor --engine stan
```

If you already have CmdStan, the CLI also finds it through the `MCMCJS_CMDSTAN` or `CMDSTAN` environment variable, or at `~/.cmdstan`, shared with other Stan interfaces.

## Libraries

The CLI is the unscoped `mcmcjs` package.
The internal libraries it is built from publish under the `@mcmcjs/*` scope (for example `@mcmcjs/core` and `@mcmcjs/diagnostics`).
You do not need to install those directly to use the CLI; see [Packages](/docs/dev/packages/) if you want to build on them.

## Next steps

Fit and diagnose your first model in the [Quickstart](/docs/quickstart/).
