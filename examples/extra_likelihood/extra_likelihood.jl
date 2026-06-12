using Turing

# Adding a likelihood term by hand with `@addlogprob!`, from the Turing
# "Modifying the log-probability" guide. Here the observations contribute a
# Normal likelihood for the mean `mu` that is added directly to the log-density
# instead of through a `~` statement.
myloglikelihood(x, mu) = loglikelihood(Normal(mu, 1), x)

@model function extra_likelihood(x)
    mu ~ Normal()
    @addlogprob! myloglikelihood(x, mu)
end

build_model(data) = extra_likelihood(Float64.(data.x))
