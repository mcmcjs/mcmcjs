---
layout: ../../layouts/DocsLayout.astro
title: Quickstart
description: Fit a model and diagnose convergence in a few commands.
---

This walkthrough goes end to end: provision Julia, scaffold an example, fit it, and read the verdict.
It assumes you have installed the CLI ([Installation](/docs/install/)).

## 1. Provision Julia

```bash
mcmc setup
```

## 2. Scaffold an example

`mcmc init` seeds a directory with a runnable example model and its data, with no shell and no prompts.

```bash
mcmc init demo
```

```
seeded README.md, data.csv, model.jl, model.stan, run_without_mcmcjs.jl in /path/to/demo
try: mcmc run demo/model.jl
```

The seeded `model.jl` is a Turing linear regression that exposes a `build_model(data)` entry point:

```julia
using Turing

@model function linear_regression(N, x, y)
    alpha ~ Normal(0, 10)
    beta ~ Normal(0, 10)
    sigma ~ truncated(Cauchy(0, 2); lower = 0)
    for i in 1:N
        y[i] ~ Normal(alpha + beta * x[i], sigma)
    end
end

build_model(data) = linear_regression(data.N, data.x, data.y)
```

## 3. Run inference

`mcmc run` is the zero-config front door: it fits, diagnoses, and records the run in a project-local store.

```bash
cd demo
mcmc run model.jl --data data.csv --seed 42
```

When it finishes you get the convergence verdict, printed as a diagnostics table:

```
variable  mean   std    r_hat  ess_bulk  ess_tail  mcse   hdi
--------  -----  -----  -----  --------  --------  -----  --------------
alpha     2.054  0.245  1.006  1378      1391      0.007  [1.601, 2.516]
beta      2.991  0.040  1.003  1447      1472      0.001  [2.918, 3.064]
sigma     0.344  0.108  1.002  1277      1686      0.003  [0.183, 0.528]

divergences: 0
converged (R-hat <= 1.01, ESS >= 400, divergences <= 0)
```

The fit recovers `alpha = 2`, `beta = 3`, exactly as the example data was generated.
The process exits `0` because every variable converged; a non-convergent fit would exit `2`.

### Stan

The scaffold also seeds `model.stan`, the same regression written in Stan and sharing `data.csv`, so the flow is identical for the Stan engine.
Provision it once with `mcmc setup --engine stan` ([Installation](/docs/install/)), then:

```bash
mcmc run model.stan --data data.csv --seed 42
```

The first run compiles the model through CmdStan, which takes half a minute or so; compiled models are cached, so later runs start instantly.

## 4. Inspect the run

The run is recorded in a hidden `.mcmc/` store, so you can revisit it without refitting.

```bash
mcmc summary          # posterior summary table
mcmc diagnose         # convergence verdict + exit code
mcmc plot --kind trace
```

`mcmc plot --kind forest` renders a terminal interval plot:

```
parameter  mean & 94% HDI                         R-hat
alpha                       ────━●━━────         1.006   2.054  [1.601, 2.516]
beta                                        ─●─  1.003   2.991  [2.918, 3.064]
sigma     ─━●━─                                  1.002   0.344  [0.183, 0.528]
```

<div class="callout note"><p>Running <code>mcmc run</code> again with unchanged model, data, and settings reuses the recorded run instead of refitting. Pass <code>--refit</code> to force a fresh fit.</p></div>

## Next steps

- Learn the inference commands in [Run inference](/docs/guides/run/).
- Read all the diagnostics in [Diagnose convergence](/docs/guides/diagnose/).
- Explore the plot kinds in [Plot](/docs/guides/plot/).
