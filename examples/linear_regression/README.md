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

## Stan version

```bash
cd examples/linear_regression
mcmc run linear_regression.stan
```

The `transformed data` block replicates the adapter's z-scoring: it stacks `cyl`, `hp`, `wt` into a design matrix and standardises each column and `mpg` with the sample mean and standard deviation (N-1), matching Julia's `std`.
`sigma2` is the response variance (a half-normal via the `<lower=0>` bound), so the likelihood uses `sqrt(sigma2)` as the scale.
The parameter names (`intercept`, `beta`, `sigma2`) match the Julia chain names for side-by-side diagnostics.
