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
