# Bayesian linear regression (mtcars)

Predict fuel economy (`mpg`) from `cyl`, `hp`, and `wt` with a Gaussian
likelihood and an `MvNormal` coefficient prior, from the Turing
[Bayesian Linear Regression](https://turinglang.org/docs/tutorials/bayesian-linear-regression/)
tutorial. The adapter z-scores predictors and target (as the tutorial does), so
the standardised coefficients are directly comparable in magnitude.

```bash
cd examples/linear_regression
mcmc run linear_regression.jl
```

`wt` (weight) gets the strongest negative standardised coefficient.
