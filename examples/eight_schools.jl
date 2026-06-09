using Turing

# A model file defines the model plus `build_model(data)`, which the driver calls
# with the spec's [data] table as a NamedTuple and expects a sampleable model back.
@model function eight_schools(J, y, sigma)
    mu ~ Normal(0, 5)
    tau ~ truncated(Cauchy(0, 5); lower = 0)
    theta ~ filldist(Normal(mu, tau), J)
    for j in 1:J
        y[j] ~ Normal(theta[j], sigma[j])
    end
end

build_model(data) = eight_schools(data.J, data.y, data.sigma)
