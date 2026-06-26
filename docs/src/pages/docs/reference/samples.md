---
layout: ../../../layouts/DocsLayout.astro
title: Samples file
description: The MCMCChains JSON samples format and the formats the CLI can read.
---

The samples file is the canonical output of inference and the canonical input to diagnostics and plotting.
Inference writes [MCMCChains](https://github.com/TuringLang/MCMCChains.jl) JSON; the CLI can read several other formats on input.

## MCMCChains JSON (written)

This is the JSON shape produced by lowering an `MCMCChains.Chains` object.

```json
{
  "size": [1000, 17, 4],
  "value_flat": [2.226, 2.597, 2.816, ...],
  "parameters": ["alpha", "beta", "sigma", "n_steps", "...", "logjoint"],
  "iterations": [1, 2, 3, ...],
  "chains": [1, 2, 3, 4],
  "name_map": {
    "parameters": ["alpha", "beta", "sigma"],
    "internals": ["n_steps", "acceptance_rate", "hamiltonian_energy", "numerical_error", "tree_depth", "..."]
  },
  "info": {}
}
```

- **`size`** is `[iterations, parameters, chains]`.
- **`value_flat`** holds every value, flattened. A value at iteration `i`, parameter `p`, chain `c` lives at index `i + p * iterations + c * iterations * parameters`.
- **`parameters`** names every column, including sampler statistics.
- **`name_map`** splits those columns: `parameters` are the model variables, `internals` are the per-draw sampler statistics.

Multidimensional variables are scalarized: an entry `theta[1,2]` is one column.

## Sampler statistics

The per-draw sampler statistics travel in the same file, under `name_map.internals`.
A NUTS fit captures, among others, `acceptance_rate`, `tree_depth`, `n_steps`, `step_size`, `hamiltonian_energy` (the energy used by the energy plot), and `numerical_error` (the divergence flag the diagnostics count).
This is why `mcmc diagnose` can report divergences and `mcmc plot --kind energy` works straight from the samples file.

## Formats the CLI can read

`parseSamples` auto-detects the format of an input file, so `diagnose`, `summary`, `plot`, and `samples` accept any of:

- **MCMCChains JSON** — detected by the `size` and `value_flat` fields.
- **ArviZ InferenceData JSON** — detected by groups containing a `data_vars` object.
- **Turing.jl CSV** — wide (`iteration,chain`), wide (`chain_,draw_`), or long layouts, sniffed before JSON parsing.

In addition, the `@mcmcjs/core` library exposes `fromStanCSV` and `fromStanCSVFiles` to read [CmdStan](https://mc-stan.org) output CSV, keeping the standard diagnostic columns (`lp__`, `energy__`, `divergent__`, `treedepth__`, and the like) under canonical names.

<div class="callout note"><p>MCMCChains JSON is what gets <em>written</em>. ArviZ InferenceData and the CSV formats are read-only on input; an ArviZ/NetCDF writer is not built.</p></div>

## Re-exporting

`mcmc samples [target]` re-exports the raw draws in a portable format, defaulting to stdout:

```bash
mcmc samples --to json            # chain-major JSON (default)
mcmc samples --to mcmcchains-json # MCMCChains JSON
```

`--to json` emits a simpler chain-major layout; `--to mcmcchains-json` round-trips the MCMCChains shape losslessly.
Add `-o <file>` to write to a file, `--warmup <n>` to drop warmup draws, or `--stdin` to read from a pipe.
