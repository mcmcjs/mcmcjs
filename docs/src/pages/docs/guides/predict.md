---
layout: ../../../layouts/DocsLayout.astro
title: Predict
description: Draw posterior-predictive samples from a fitted model.
---

`mcmc predict <spec> <samples>` draws posterior-predictive samples from a model you have already fitted.
It takes the spec and the posterior samples file from a previous fit, and produces a new samples file of predicted outcomes.

```bash
mcmc predict model.toml samples.json -o predictions.json
```

| Flag | Meaning |
| --- | --- |
| `-o, --out <file>` | samples output path |
| `--julia-version <channel>` | Julia version/channel to run, overriding the spec |
| `--verbose` | show the full raw install/precompile output |
| `--json` | print the result as JSON |

Like `fit`, `predict` runs a Julia subprocess, so it is one of the few commands that touch Julia.

## The `[predict]` block

Which outcomes to predict is declared in a `[predict]` table in the spec.
`targets` lists the outcome variables by base name; each is blanked to missing so the sampler draws it from the posterior predictive.
You can optionally override the data used for the prediction.

```toml
[predict]
targets = ["y"]

[predict.data]
x = [11, 12, 13, 14, 15]
```

`predict.data` is merged on top of the spec's `[data]`, so you can predict at new covariate values without editing the rest of the spec.
See [the Spec file reference](/docs/reference/spec/) for the full schema.

<div class="callout note"><p><code>mcmc predict</code> is supported for the Turing backend today.</p></div>
