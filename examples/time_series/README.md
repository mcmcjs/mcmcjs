# Autoregressive time series (AR(1))

The canonical Bayesian time-series model: each observation is a noisy linear
function of the previous one, `y[t] ~ Normal(alpha + phi * y[t-1], sigma)`. A
relative of the Turing
[Bayesian Time Series Analysis](https://turinglang.org/docs/tutorials/bayesian-time-series-analysis/)
tutorial, chosen here because it is well identified and samples cleanly.

```bash
cd examples/time_series
mcmc run time_series.jl --data data.csv
```

The data is a 50-step AR(1) series with `phi = 0.7`; the posterior recovers
`phi` near 0.7 and a stationary mean (`alpha / (1 - phi)`) near 6.7.

## Stan version

```bash
mcmc run time_series.stan --data data.csv
```

A direct translation: the `phi` bounds `real<lower=-1, upper=1>` give the uniform prior implicitly, and the half-normal on `sigma` is the `lower=0` constraint plus a `normal(0, 1)` statement.
