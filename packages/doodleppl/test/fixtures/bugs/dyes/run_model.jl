using JuliaBUGS
using ADTypes, Mooncake
using AbstractMCMC, AdvancedHMC, FlexiChains
using Random

data = (
  batches = 6,
  samples = 5,
  y = [
        1545 1440 1440 1520 1580
        1540 1555 1490 1560 1495
        1595 1550 1605 1510 1560
        1445 1440 1595 1465 1545
        1595 1630 1515 1635 1625
        1520 1455 1450 1480 1445
    ]
)

inits = (
  theta = 1500,
  tau_with = 1,
  tau_btw = 1
)

model_def = JuliaBUGS.@bugs("""
model {
  for (i in 1:batches) {
    for (j in 1:samples) {
      y[i,j] ~ dnorm(mu[i], tau.with)
    }
    mu[i] ~ dnorm(theta, tau.btw)
  }
  theta ~ dnorm(0.0, 1.0E-10)
  tau.btw ~ dgamma(0.001, 0.001)
  tau.with ~ dgamma(0.001, 0.001)
  sigma2.btw <- 1 / tau.btw
  sigma2.with <- 1 / tau.with
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
