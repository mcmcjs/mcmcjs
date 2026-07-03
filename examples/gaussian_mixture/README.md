# Gaussian mixture (marginalised, NUTS)

A two-component 1-D mixture where the discrete cluster assignments are summed
out by `MixtureModel`, leaving a continuous model that NUTS can sample. Adapted
from the Turing
[Gaussian Mixture Models](https://turinglang.org/docs/tutorials/gaussian-mixture-models/)
tutorial; separated priors on the two means stand in for `Bijectors.ordered`
to discourage label switching.

```bash
cd examples/gaussian_mixture
mcmc run gaussian_mixture.jl
```

`mu1` recovers near -2 and `mu2` near +2. Mixtures are multimodal, so a slightly
elevated R-hat here is expected and instructive.

## Stan version

```bash
mcmc run gaussian_mixture.stan
```

The Stan translation keeps the cluster assignments marginalised by accumulating `log_mix(w[1], normal_lpdf(y | mu1, sigma), normal_lpdf(y | mu2, sigma))` per observation, matching Turing's `MixtureModel`.
The half-normal prior on `sigma` is a `normal(0, 1)` prior on a `<lower=0>` parameter, and `w` is a `simplex[2]` with a flat Dirichlet prior.
Depending on the seed, individual chains can land in the label-switched mode (`mu1` and `mu2` swapped), which shows up as a large cross-chain R-hat on the means even though each chain fits cleanly.
