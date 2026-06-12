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
