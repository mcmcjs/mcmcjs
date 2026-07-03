# Normal model (JuliaBUGS backend)

The same "estimate a mean and precision" idea as the `gaussian` example, but
written for the **JuliaBUGS** backend instead of Turing: the model is a
top-level `@bugs` block compiled against the data. This is the example to run to
exercise the non-Turing path; mcmc auto-detects the backend from the `JuliaBUGS`
in the source.

```bash
cd examples/normal_bugs
mcmc run normal.jl --data data.csv
```

The CSV's row count becomes `N` automatically, and `mu` recovers near the data
mean (~1.08).

## Stan version

A hand-written Stan translation lives in `normal.stan`.

```bash
cd examples/normal_bugs
mcmc run normal.stan --data data.csv
```

Translation notes: BUGS parameterizes the normal by precision, so `dnorm(0, 0.0001)` becomes `normal(0, 100)` (sd = 1/sqrt(precision)) and `y[i] ~ dnorm(mu, tau)` becomes `y ~ normal(mu, inv_sqrt(tau))`.
The `dgamma(0.01, 0.01)` prior on `tau` maps directly to Stan's shape-rate `gamma(0.01, 0.01)`, and `sigma = 1 / sqrt(tau)` is a generated quantity.
Parameter names (`mu`, `tau`, `sigma`) match the JuliaBUGS chain names for side-by-side diagnostics.
