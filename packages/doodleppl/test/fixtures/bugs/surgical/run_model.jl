using JuliaBUGS
using ADTypes, Mooncake
using AbstractMCMC, AdvancedHMC, FlexiChains
using Random

data = (
  n = [47, 148, 119, 810, 211, 196, 148, 215, 207, 97, 256, 360],
  r = [0, 18, 8, 46, 8, 13, 9, 31, 14, 8, 29, 24],
  N = 12
)

inits = (
  p = [0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1],
)

model_def = JuliaBUGS.@bugs("""
model {
  for (i in 1:N) {
    p[i] ~ dbeta(1.0, 1.0)
    r[i] ~ dbin(p[i], n[i])
  }
}
""", true, false)

model = model_def(data; adtype = AutoMooncake(; config = nothing))
initialize!(model, inits)
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
    )
elseif n_chains > 1
    chain = AbstractMCMC.sample(
        rng, model, NUTS(0.65), MCMCSerial(), n_samples, n_chains;
        chain_type = FlexiChains.VNChain, n_adapts = n_adapts,
        discard_initial = n_adapts, progress = false,
    )
else
    chain = AbstractMCMC.sample(
        rng, model, NUTS(0.65), n_samples;
        chain_type = FlexiChains.VNChain, n_adapts = n_adapts,
        discard_initial = n_adapts, progress = false,
    )
end

println(summarystats(chain))
