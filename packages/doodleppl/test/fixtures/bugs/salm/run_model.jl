using JuliaBUGS
using ADTypes, Mooncake
using AbstractMCMC, AdvancedHMC, FlexiChains
using Random

data = (
  doses = 6,
  plates = 3,
  y = [
        15 21 29
        16 18 21
        16 26 33
        27 41 60
        33 38 41
        20 27 42
    ],
  x = [0, 10, 33, 100, 333, 1000]
)

inits = (
  alpha = 0,
  beta = 0,
  gamma = 0,
  tau = 0.1
)

model_def = JuliaBUGS.@bugs("""
model {
  for (i in 1:doses) {
    for (j in 1:plates) {
      lambda[i,j] ~ dnorm(0.0, tau)
      y[i,j] ~ dpois(mu[i, j])
      mu[i,j] <- exp(alpha + beta * log(x[i] + 10) + gamma * x[i] + lambda[i, j])
    }
  }
  alpha ~ dnorm(0.0, 1.0E-6)
  beta ~ dnorm(0.0, 1.0E-6)
  gamma ~ dnorm(0.0, 1.0E-6)
  tau ~ dgamma(0.001, 0.001)
  sigma <- 1 / sqrt(tau)
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
