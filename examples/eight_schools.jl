using Turing

# The model file a spec references must define `build_model(data)` returning a
# Turing model. `data` is the spec's [data] table as a NamedTuple.
function build_model(data)
    @model function eight_schools(J, y, sigma)
        mu ~ Normal(0, 5)
        tau ~ truncated(Cauchy(0, 5); lower = 0)
        theta ~ filldist(Normal(mu, tau), J)
        for j in 1:J
            y[j] ~ Normal(theta[j], sigma[j])
        end
    end
    return eight_schools(data.J, data.y, data.sigma)
end
