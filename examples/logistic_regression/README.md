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
