# Gaussian mean and variance (`gdemo`)

Estimate the mean `m` and variance `s2` of a Normal from i.i.d. data, with an
`InverseGamma(2, 3)` prior on the variance. This is the canonical `gdemo` model
from the Turing [Getting Started](https://turinglang.org/docs/) guide.

```bash
cd examples/gaussian
mcmc run gaussian.jl
```

The data are 25 draws from `Normal(5, 2)`, so `m` recovers near 5 and `sqrt(s2)`
near 2.

## Stan version

```bash
mcmc run gaussian.stan
```

A direct translation of the Turing model with the same parameter names (`s2`, `m`) and the same variance parameterization, so both backends can be diagnosed side by side.
