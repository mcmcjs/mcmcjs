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
