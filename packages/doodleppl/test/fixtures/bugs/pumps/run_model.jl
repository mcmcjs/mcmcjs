using JuliaBUGS
using ADTypes, Mooncake
using AbstractMCMC, AdvancedHMC, FlexiChains
using Random

data = (
  t = [94.3, 15.7, 62.9, 126, 5.24, 31.4, 1.05, 1.05, 2.1, 10.5],
  x = [5, 1, 5, 14, 3, 19, 1, 1, 4, 22],
  N = 10
)

inits = (
  alpha = 1,
  beta = 1
)

model_def = JuliaBUGS.@bugs("""
model {
  for (i in 1:N) {
    theta[i] ~ dgamma(alpha, beta)
    x[i] ~ dpois(lambda[i])
    lambda[i] <- theta[i] * t[i]
  }
  alpha ~ dexp(1)
  beta ~ dgamma(0.1, 1.0)
}
""", true, false)

model = model_def(data)
model = JuliaBUGS.initialize!(model, inits)
init_vec = JuliaBUGS.getparams(model)
model = JuliaBUGS.BUGSModelWithGradient(model, AutoMooncake(; config = nothing))
n_samples, n_adapts = 1000, 1000
n_chains = 4
seed = 42

seed_val = tryparse(Int, string(seed))
rng = seed === nothing ? Random.default_rng() : (seed_val === nothing ? Random.default_rng() : Random.MersenneTwister(seed_val))

if n_chains > 1 && Threads.nthreads() > 1
    chain = AbstractMCMC.sample(
        rng, model, NUTS(0.65), MCMCThreads(), n_samples, n_chains;
        chain_type = FlexiChains.VNChain, n_adapts = n_adapts,
        discard_initial = n_adapts, progress = false,
        initial_params = init_vec === nothing ? nothing : fill(init_vec, n_chains),
    )
elseif n_chains > 1
    chain = AbstractMCMC.sample(
        rng, model, NUTS(0.65), MCMCSerial(), n_samples, n_chains;
        chain_type = FlexiChains.VNChain, n_adapts = n_adapts,
        discard_initial = n_adapts, progress = false,
        initial_params = init_vec === nothing ? nothing : fill(init_vec, n_chains),
    )
else
    chain = AbstractMCMC.sample(
        rng, model, NUTS(0.65), n_samples;
        chain_type = FlexiChains.VNChain, n_adapts = n_adapts,
        discard_initial = n_adapts, progress = false,
        initial_params = init_vec,
    )
end

println(summarystats(chain))
