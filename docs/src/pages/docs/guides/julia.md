---
layout: ../../../layouts/DocsLayout.astro
title: Manage Julia
description: Provision Julia, manage versions, and run persistent workers.
---

Inference runs in Julia, and MCMC.js can install and manage it for you.
This guide covers provisioning the toolchain, checking it, managing Julia versions, and the persistent worker daemon.

## Provision and check

`mcmc setup` installs the Julia toolchain (juliaup and Julia) and precompiles the managed project.

```bash
mcmc setup            # install and precompile
mcmc setup --dry-run  # show what would be installed, change nothing
```

`mcmc doctor` reports the toolchain MCMC.js needs and whether you are ready to fit.
`mcmc engines` lists the inference engines the CLI knows about and their capabilities.

```bash
mcmc doctor
mcmc engines
```

```
julia    ready  setup, versions, fit, predict
```

## Managing Julia versions

`mcmc julia version` wraps [juliaup](https://github.com/JuliaLang/juliaup) channels.

| Command | What it does |
| --- | --- |
| `mcmc julia version list` | list installed Julia versions |
| `mcmc julia version status` | installed versions plus the juliaup and Julia toolchain |
| `mcmc julia version add <version>` | install a version or channel, e.g. `1.10` or `release` (`--default` to also set it) |
| `mcmc julia version remove <version>` | uninstall a version or channel |
| `mcmc julia version default <version>` | set the default version or channel |
| `mcmc julia version update [version]` | update one channel, or all installed channels |
| `mcmc julia version gc` | reclaim disk from uninstalled Julia versions |

```bash
mcmc julia version add 1.11 --default
mcmc julia version status
```

```
juliaup  1.20.7  /home/you/.juliaup/bin/juliaup
julia    1.12.6  /home/you/.juliaup/bin/julia

* release    1.12.6     .../julia-1.12.6/bin/julia
  1.11       1.11.9     .../julia-1.11.9/bin/julia
```

All of these accept `--json`, and the mutating commands accept `--verbose` for the raw juliaup output.

## Running on a chosen version

A fit runs on the Julia channel pinned in the spec's `[backend].version` (a specific version, not a moving channel, so a run reproduces the resolved package set).
Override it per command with `--julia-version`:

```bash
mcmc run model.jl --julia-version 1.11
```

### Version matrices

`mcmc fit` can run one spec across several Julia versions, or several versions of one managed package, each in its own isolated managed environment:

```bash
mcmc fit model.toml --versions 1.11,1.12 -o out/
mcmc fit model.toml --package-versions Turing=0.44,0.45 -o out/
```

See [Run inference](/docs/guides/run/) for the matrix flags.

## Persistent workers (daemon)

Each `fit` normally starts a fresh Julia process, paying Julia's startup and load cost every time.
A persistent worker keeps a Julia process warm and runs fits through it.

Start one by adding `--daemon` to a fit (or set `MCMC_DAEMON=1`):

```bash
mcmc run model.jl --daemon
```

Manage the workers with the `daemon` group:

```bash
mcmc daemon status   # list known workers and whether they answer
mcmc daemon stop     # stop all workers and remove their sockets
```

```
no workers; start one with `mcmc run <model> --daemon`
```

Both subcommands accept `--json`.
