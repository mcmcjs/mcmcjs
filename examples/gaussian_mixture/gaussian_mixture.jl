using Turing

# Two-component 1-D Gaussian mixture, adapted from the Turing "Gaussian Mixture
# Models" tutorial. The cluster assignments are marginalised out by `MixtureModel`,
# so the model is continuous and NUTS-compatible (no Gibbs/particle sampler).
# The component means get separated priors instead of `Bijectors.ordered`
# (unavailable here) to discourage label switching.
@model function gaussian_mixture(y)
    mu1 ~ Normal(-2, 1)
    mu2 ~ Normal(2, 1)
    sigma ~ truncated(Normal(0, 1); lower = 0)
    w ~ Dirichlet(2, 1.0)
    components = [Normal(mu1, sigma), Normal(mu2, sigma)]
    for i in eachindex(y)
        y[i] ~ MixtureModel(components, w)
    end
end

build_model(data) = gaussian_mixture(Float64.(data.y))
