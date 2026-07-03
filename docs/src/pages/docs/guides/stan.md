---
layout: ../../../layouts/DocsLayout.astro
title: Use Stan
description: Provision CmdStan, run Stan models, and manage CmdStan versions.
---

Stan models run through a local CmdStan, and MCMC.js can install and manage it for you.
This guide covers provisioning CmdStan, running Stan models, managing CmdStan versions, the compile cache, and prediction through generated quantities.

## Provision and check

`mcmc setup --engine stan` downloads a CmdStan release and builds it (one time, a few minutes).

```bash
mcmc setup --engine stan                        # install the pinned CmdStan (2.39.0)
mcmc setup --engine stan --stan-version 2.38.0  # install a specific version
```

CmdStan installs into a managed root, `$XDG_DATA_HOME/mcmcjs/stan` (defaulting to `~/.local/share/mcmcjs/stan`).
An existing install in `~/.cmdstan`, the conventional home shared with other Stan interfaces, is picked up as-is, so setup is unnecessary when you already have CmdStan there.
You can also point `MCMCJS_CMDSTAN` (or `CMDSTAN`) at any CmdStan directory; an explicit home wins over everything else.

`mcmc doctor --engine stan` reports the toolchain (make, a C++ compiler, CmdStan, stanc) and whether you are ready to fit.

```bash
mcmc doctor --engine stan
mcmc engines
```

```
julia    ready  setup, versions, fit, predict
stan     ready  setup, versions, fit, predict
```

## Running Stan models

`mcmc run` accepts a `.stan` model directly and runs the full workflow: fit, diagnostics, and the run store, with reuse and `--stream-out` working exactly as for Julia models.

```bash
mcmc run model.stan --data data.json --seed 42
```

With no `--data` flag, a sibling data file next to the model is picked up automatically: `<model>.csv`, then `data.csv`, then `data.json`.
Every example in the repository's `examples/` directory has a `.stan` sibling sharing the same data as its Julia model.

A spec file selects Stan through its `[backend]` table:

```toml
[backend]
id = "stan"
```

`version` defaults to `"installed"`, which resolves to the newest local CmdStan; pin a concrete version such as `"2.39.0"` to make the run reproduce on exactly that CmdStan.

```bash
mcmc fit model.toml -o samples.json
```

## Managing CmdStan versions

`mcmc stan version` manages the CmdStan installs under the managed root.

| Command | What it does |
| --- | --- |
| `mcmc stan version list` | list installed CmdStan versions, newest first |
| `mcmc stan version status` | installed versions plus the make and C++ toolchain |
| `mcmc stan version add <version>` | download and build a CmdStan version |
| `mcmc stan version remove <version>` | remove a managed install (never touches `~/.cmdstan`) |

The newest install is the default: the `installed` channel resolves to it.
`mcmc fit` can run one Stan spec across several installed CmdStan versions:

```bash
mcmc fit model.toml --versions 2.38.0,2.39.0 -o out/
```

## The compile cache

CmdStan compiles each Stan model to a native executable through make.
MCMC.js caches the compiled binary under the managed root, keyed by a content hash of the model source (including any `#include`d files) and the CmdStan version.
The first fit of a model pays the compile, roughly 30 to 60 seconds; fitting the same source again starts sampling immediately, and editing the model or switching CmdStan versions recompiles.

Sampling runs one CmdStan process per chain, in parallel, all sharing the spec's seed with a per-chain stream id.

## Predict through generated quantities

`mcmc predict` runs CmdStan's `generate_quantities`: the model's own `generated quantities` block re-runs once per posterior draw.
The model must have one, and `[predict].targets` selects which generated variables become the predictive samples file:

```stan
generated quantities {
  array[N] real y_rep;
  for (n in 1:N) y_rep[n] = normal_rng(alpha + beta * x[n], sigma);
}
```

```toml
[predict]
targets = ["y_rep"]
```

```bash
mcmc predict model.toml samples.json -o predictions.json
```

Unlike the Julia backends, targets are not blanked to missing: prediction comes from the generated quantities block, which reads the data as-is.

## Julia-only flags

A Stan run starts no Julia process, so the Julia-specific flags error on a Stan spec: `--daemon`, `--julia-version`, `--package`, and `--package-versions`.
`--entry` selects a Julia model entry function and is meaningless for a `.stan` model.

## Windows

`mcmc setup --engine stan` is POSIX-only for now; Windows setup is not supported yet.
