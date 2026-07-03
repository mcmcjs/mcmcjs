# Bayesian logistic regression (loan default)

Predict a binary outcome (loan default) from `student`, `balance`, and `income`
through a logistic link, from the Turing
[Bayesian Logistic Regression](https://turinglang.org/docs/tutorials/bayesian-logistic-regression/)
tutorial. Continuous predictors are standardised in the adapter.

```bash
cd examples/logistic_regression
mcmc run logistic_regression.jl
```

The data were generated with a strong positive `balance` effect, so `b_balance`
is clearly positive.

## Stan version

```bash
mcmc run logistic_regression.stan
```

The Stan port keeps the same parameter names for side-by-side diagnostics.
It z-scores `balance` and `income` in `transformed data`, matching the Julia adapter, while `student` stays a raw 0/1 flag.
