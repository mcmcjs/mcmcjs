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
