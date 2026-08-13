---
name: mcmcjs
description: Write Bayesian models for Turing.jl, JuliaBUGS, or Stan and fit them with the mcmc CLI. Use when asked to build, fit, diagnose, compare, or validate a Bayesian model, or when a project holds .mcmc run stores, model .jl files, or mcmc spec files.
---

# Bayesian modelling with mcmcjs

`mcmc` fits a model and records the run. You write the model file; the CLI
provisions the runtime, samples, and reports diagnostics.

## The contract that matters most

A fit calls **one entry function with the data table**:

```julia
using Turing

@model function eight_schools(J, y, sigma)
    mu ~ Normal(0, 5)
    tau ~ truncated(Cauchy(0, 5); lower = 0)
    theta ~ filldist(Normal(mu, tau), J)
    for j in 1:J
        y[j] ~ Normal(theta[j], sigma[j])
    end
end

build_model(data) = eight_schools(data.J, data.y, data.sigma)
```

Rules, in order of how often they are broken:

1. **Define `build_model(data)`.** It takes one argument, the data table, and
   returns the model. Without it the fit fails with "defines no entry
   function". `mcmc run` prints the exact line to add.
2. **Write `@model` at the top level.** Never nest the macro inside another
   function; the adapter is a separate one-line function, as above.
3. **Read data through the argument.** `data.y` and `data["y"]` both work. A
   model that closes over globals will not fit.
4. Outcomes must be **arguments of the model**, not read from a global, or
   Turing samples them instead of conditioning on them.

For Stan there is no adapter: a `.stan` file is self-contained, and `mcmc run
model.stan --data data.json` just works.

## The workflow

```bash
mcmc run model.jl --data data.csv     # fit, diagnose, record
mcmc diagnose                          # R-hat, ESS, MCSE, divergences
mcmc summary                           # mean, sd, HDI per variable
mcmc plot --kind trace                 # look at the chains
mcmc loo && mcmc compare @1 @2         # out-of-sample fit, then rank
mcmc sbc model.jl --simulations 20     # is the model calibrated at all?
```

Runs land in a project-local `.mcmc/` store beside the model and are addressed
as `latest`, `@1` (newest), or an id prefix.

## Reading the verdict

`mcmc run` exits `0` when it converged, `2` when it ran but did not, and `1` on
a real error. **Exit 2 is a result.** Do not retry the same fit; read the
diagnostics and change something:

| Symptom | Usual cause | What to change |
| --- | --- | --- |
| R-hat > 1.01 | chains disagree | run longer, or reparameterize |
| Low ESS, high autocorrelation | slow mixing | reparameterize; raise `--adapt-delta` |
| Divergences > 0 | funnel geometry | non-centered parameterization |
| Fit fails at compile | model file contract | see the rules above |

The classic case is the eight-schools funnel: a centered hierarchical model
gives divergences and low ESS, and the fix is non-centering, not more draws.

## Before trusting a model you wrote

A model that samples cleanly can still encode the wrong thing. In order:

1. `mcmc run --prior` and check the prior predictive draws are physically
   plausible.
2. Fit, and read `mcmc diagnose`.
3. `mcmc sbc` to test calibration: it draws from the prior, simulates data,
   refits, and checks the rank histogram is uniform. Non-uniform ranks mean the
   model or the sampler is wrong even when R-hat looks fine.

## Settings

Flags always win over a spec file, and every command takes `--json`.

```bash
mcmc run model.jl --draws 2000 --chains 4 --seed 42 --adapt-delta 0.95
mcmc run model.jl --algorithm NUTS       # or HMC, MH, SMC, PG, Gibbs, External
mcmc run model.jl --parallel threads     # chains concurrently
```

A spec file (`.toml`) is only needed to keep settings under version control or
to declare `[predict]` targets; `mcmc run` works from a bare model file.

## What not to do

- Do not edit anything under `.mcmc/`: it is a record, and the CLI reads it.
- Do not report parameter estimates from a run whose verdict is not converged
  without saying so.
- Do not raise `--draws` to fix divergences; that hides the geometry problem.
