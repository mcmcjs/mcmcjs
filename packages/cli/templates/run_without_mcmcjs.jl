# The same analysis with plain Julia, no mcmcjs. Run it with:
#
#   julia> using Pkg; Pkg.add("Turing")   # once
#   $ julia run_without_mcmcjs.jl
#
using Turing
using Random

@model function linear_regression(N, x, y)
    alpha ~ Normal(0, 10)
    beta ~ Normal(0, 10)
    sigma ~ truncated(Cauchy(0, 2); lower = 0)
    for i in 1:N
        y[i] ~ Normal(alpha + beta * x[i], sigma)
    end
end

# The data has to live in the script (or you write your own CSV reading).
x = [1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0, 10.0]
y = [5.2, 7.7, 11.1, 13.8, 17.4, 19.9, 23.3, 25.6, 29.2, 31.8]

Random.seed!(42)
model = linear_regression(length(x), x, y)
chain = sample(model, NUTS(1000, 0.8), MCMCSerial(), 1000, 4)

display(Turing.summarystats(chain))
# Convergence judgement, saving the draws, and keeping a record of what ran
# are all up to you from here.
