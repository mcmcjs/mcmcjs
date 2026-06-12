using Turing

# Per-group means with a shared prior, from the Turing core-functionality guide
# (the `filldist` + integer group-index example). Each observation is drawn from
# its group's mean; the group index `g` is observed data, not a parameter.
@model function hierarchical_groups(x, g)
    k = length(unique(g))
    a ~ filldist(Exponential(), k)
    mu = a[g]
    for i in eachindex(x)
        x[i] ~ Normal(mu[i], 1)
    end
    return mu
end

build_model(data) = hierarchical_groups(Float64.(data.x), Int.(data.g))
