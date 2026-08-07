---
layout: ../../../layouts/DocsLayout.astro
title: Check and compare models
description: Prior and posterior predictive checks, PSIS-LOO cross-validation, and model ranking.
---

Convergence diagnostics tell you the sampler worked; they say nothing about whether the model is any good.
The commands on this page cover the other half of the workflow: checking a model against its own predictions and comparing candidate models by out-of-sample fit.

## Prior predictive checks

Before fitting, draw from the prior and push those draws through the model to see what data it considers plausible.
Prior sampling reuses the ordinary fit pipeline: pass `--prior` (or set `algorithm = "Prior"` in the spec's `[sampler]`), and every downstream command works on the result.

```bash
mcmc run model.jl --data data.json --prior --draws 500
mcmc predict model.toml prior-samples.json -o prior-pred.json
mcmc plot prior-pred.json --kind ppc-density --observed data.json
```

Prior draws are independent, so there is no warmup and no adaptation; the run completes in seconds.
If the prior predictive puts most of its mass on absurd data, revisit the priors before spending time on inference.

## Posterior predictive checks

After fitting, generate replicate datasets with `mcmc predict` and compare them to the observed data.

```bash
mcmc predict model.toml samples.json -o yrep.json
mcmc plot yrep.json --kind ppc-density --observed data.json
mcmc plot yrep.json --kind ppc-stat --observed data.json --stat sd
```

- `ppc-density` overlays the observed data's density on the densities of predictive replicates. The observed curve should look like one more member of the band.
- `ppc-stat` histograms a test statistic T over the replicates and marks the observed T(y), with the one-sided p-value P(T(y_rep) >= T(y)). Statistics: `mean`, `sd`, `min`, `max`. A p-value near 0 or 1 flags an aspect of the data the model cannot reproduce.

Both kinds render to the terminal, SVG, and HTML like every other plot.

## LOO-PIT calibration

LOO-PIT asks whether each observation looks like a typical draw from its own leave-one-out predictive: for a calibrated model the PIT values are uniform.
It combines the predictive draws, the observed data, and the PSIS weights that `loo` computes.

```bash
mcmc export loglik           # materialize the cached loglik.json from the latest run
mcmc plot yrep.json --kind loo-pit --observed data.json --loglik normal.loglik.json
```

The plot shows the PIT ECDF against the uniform diagonal with a 95% simultaneous band; an ECDF escaping the band flags miscalibration (an S-shape means over- or under-dispersion, a shifted curve means bias).

## Cross-validated fit: mcmc loo

`mcmc loo [ref]` estimates a run's out-of-sample predictive fit with PSIS-LOO cross-validation (Vehtari, Gelman, Gabry 2017), alongside WAIC.

```bash
mcmc loo            # the latest run
mcmc loo @2         # any run ref
```

The pointwise log-likelihood it needs is computed once through the model (a Julia subprocess) and cached as `loglik.json` in the run directory; repeated calls are instant.
Stan models follow the usual convention instead: declare a `log_lik` vector in `generated quantities` and `loo` reads it straight from the samples.

The report shows `elpd_loo` with its standard error, the effective parameter count `p_loo`, and the Pareto k diagnostic per observation.
k values above the threshold mean the importance sampling behind LOO is unreliable for that observation; the command exits 2 in that case (0 when every k is good, 1 on error).

## Ranking models: mcmc compare

`mcmc compare <ref> <ref> [...]` ranks two or more runs fitted to the same data.

```bash
mcmc compare @1 @2
```

```text
rank  model                        elpd_loo    se  elpd_diff  se_diff  high_k
----  ---------------------------  --------  ----  ---------  -------  ------
   1  20260806-2159 (normal.jl)        1.16  1.68       0.00     0.00       0
   2  20260806-2200 (fixed.jl)       -32.71  0.01     -33.87     1.68       0
```

`elpd_diff` is each model's distance behind the winner, and `se_diff` is the standard error of that difference computed from the paired pointwise values, which is the number to judge it against.
A difference within a couple of standard errors is not a meaningful preference.
Every run must score the same observations; the command refuses to compare models fitted to different data.
