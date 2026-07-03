---
layout: ../../../layouts/DocsLayout.astro
title: Spec file
description: The declarative spec format that describes a model, its data, and the sampler.
---

A spec file declares a complete inference job: the backend, the model, the sampler, the data, and a seed.
TOML is the primary format; JSON is also accepted.
The spec is validated with [zod](https://zod.dev) before anything runs.

## A complete example

```toml
schema_version = "0"
seed = 42

[backend]
id = "turing"

[model]
kind = "file"
path = "./model.jl"
entry = "build_model"

[sampler]
algorithm = "NUTS"
draws = 1000
warmup = 1000
chains = 4
adapt_delta = 0.8

[data]
N = 10
x = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
y = [5.2, 7.7, 11.1, 13.8, 17.4, 19.9, 23.3, 25.6, 29.2, 31.8]
```

## Fields

### Top level

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `schema_version` | string | yes | must be `"0"` today |
| `seed` | integer | yes | `0` to `Number.MAX_SAFE_INTEGER`, bounded so it survives JSON without precision loss |

### `[backend]`

| Field | Type | Default | Notes |
| --- | --- | --- | --- |
| `id` | `"turing"` \| `"juliabugs"` \| `"stan"` | required | the probabilistic-programming backend |
| `runtime` | `"julia"` \| `"cmdstan"` | per backend | `"julia"` for `turing` and `juliabugs`, `"cmdstan"` for `stan` |
| `version` | string | per runtime | Julia: the juliaup channel to run, e.g. `"1.12.6"` (default: the toolchain's pinned channel); Stan: a CmdStan version, e.g. `"2.39.0"`, or `"installed"` (the default), which resolves the newest local CmdStan |
| `packages` | table of name to version | optional | Julia-only: version pins for managed Julia packages, e.g. `Turing = "0.45"` |

Pinned packages provision into their own managed environment, so different pins can be compared without interfering.

### `[model]`

| Field | Type | Default | Notes |
| --- | --- | --- | --- |
| `kind` | `"file"` | required | only file-based models today |
| `path` | string | required | path to the model file, resolved relative to the spec's directory |
| `entry` | string | `"build_model"` | the model entry function (Julia backends; ignored for Stan) |

### `[sampler]`

| Field | Type | Default | Notes |
| --- | --- | --- | --- |
| `algorithm` | `"NUTS"` | `"NUTS"` | the sampler |
| `draws` | positive integer | required | posterior draws per chain |
| `warmup` | non-negative integer | `1000` | warmup iterations |
| `chains` | positive integer | `4` | number of chains |
| `adapt_delta` | number in (0, 1) | `0.8` | NUTS target acceptance rate |

### Data

Provide data inline or by reference, but not both.

| Field | Type | Notes |
| --- | --- | --- |
| `[data]` | table | inline data, keyed by variable name |
| `data_file` | string | path to a `.csv` or `.json` data file, relative to the spec's directory |

`data_file` records the reference (path plus hash), not the contents, so large datasets are not copied into the spec or the run store.

### `[output]`

| Field | Type | Default | Notes |
| --- | --- | --- | --- |
| `format` | `"mcmcchains-json"` | `"mcmcchains-json"` | the samples-file format written |

### `[predict]`

Optional; used by [`mcmc predict`](/docs/guides/predict/).

| Field | Type | Notes |
| --- | --- | --- |
| `targets` | array of strings (at least one) | outcome variables to predict, by base name; Turing blanks each to missing, Stan keeps the matching generated quantities |
| `data` | table | optional data overrides applied on top of `[data]` for the prediction |

```toml
[predict]
targets = ["y"]
```

## JSON form

The same spec as JSON:

```json
{
  "schema_version": "0",
  "seed": 42,
  "backend": { "id": "turing" },
  "model": { "kind": "file", "path": "./model.jl", "entry": "build_model" },
  "sampler": { "algorithm": "NUTS", "draws": 1000, "warmup": 1000, "chains": 4, "adapt_delta": 0.8 },
  "data": {}
}
```

## A Stan example

The same schema drives the Stan backend.

```toml
schema_version = "0"
seed = 42
data_file = "./data.json"

[backend]
id = "stan"

[model]
kind = "file"
path = "./model.stan"

[sampler]
algorithm = "NUTS"
draws = 1000

[predict]
targets = ["y_rep"]
```

`version` defaults to `"installed"`, the newest local CmdStan; a concrete version such as `"2.39.0"` pins it.
For Stan, `[predict].targets` selects which generated quantities to keep, and the model must declare them in a `generated quantities` block.

<div class="callout note"><p>The <code>schema_version</code> lets the format evolve without silently breaking consumers. A spec with an unknown version is rejected rather than misread.</p></div>
