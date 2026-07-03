# Bayesian Poisson regression (sneeze counts)

Model daily sneeze counts as a function of alcohol intake and missed medication
through a log link, from the Turing
[Bayesian Poisson Regression](https://turinglang.org/docs/tutorials/bayesian-poisson-regression/)
tutorial. The count outcome is observed data; NUTS samples only the continuous
log-rate coefficients.

```bash
cd examples/poisson_regression
mcmc run poisson_regression.jl
```

Counts jump in the alcohol-and-no-meds group, so `b_product` (the interaction)
is strongly positive.

## Stan version

```bash
mcmc run poisson_regression.stan
```

The Stan model z-scores all three predictors (including the 0/1 dummies) in `transformed data`, matching the Julia adapter.
Priors are `normal(0, 10)` on each coefficient and the likelihood uses `poisson_log`, so parameter names and posteriors line up with the Julia chain for side-by-side diagnostics.
