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
