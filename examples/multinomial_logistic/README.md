# Multinomial logistic regression (iris)

Classify iris flowers into three species from four measurements using a softmax
likelihood with `setosa` as the pinned baseline, from the Turing
[Multinomial Logistic Regression](https://turinglang.org/docs/tutorials/multinomial-logistic-regression/)
tutorial. Features are standardised in the adapter.

```bash
cd examples/multinomial_logistic
mcmc run multinomial_logistic.jl
```

Petal length/width dominate the separation, so their coefficients are the
largest in magnitude. With only 24 points and 10 parameters this is a small,
illustrative fit.

## Stan version

A Stan translation of the same model lives in `multinomial_logistic.stan`.

```bash
cd examples/multinomial_logistic
mcmc run multinomial_logistic.stan
```

The four features are z-scored per column in the `transformed data` block, using the sample standard deviation (N-1 divisor) to match Julia's `Statistics.std`, so the standardisation the Julia adapter does happens inside the model here.
setosa stays the pinned baseline at logit 0, and `y ~ categorical_logit([0, versicolor, virginica])` is the exact equivalent of the Julia `softmax` plus `Categorical`.
Parameter names match the Turing chains (`intercept_versicolor`, `coef_virginica[1..4]`, and so on) so the two fits line up for side-by-side diagnostics.
