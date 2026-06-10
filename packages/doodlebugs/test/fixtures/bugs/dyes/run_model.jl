using JuliaBUGS, AbstractMCMC, AdvancedHMC, LogDensityProblems, LogDensityProblemsAD, MCMCChains, ReverseDiff, Random

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

# Compile the model
model = JuliaBUGS.compile(model_def, data, inits)
ad_model = ADgradient(:ReverseDiff, model)
ld_model = AbstractMCMC.LogDensityModel(ad_model)

# Sampling parameters
n_samples, n_adapts = 1000, 1000
n_chains = 4
seed = 42

seed_val = tryparse(Int, string(seed))
rng = seed === nothing ? Random.default_rng() : (seed_val === nothing ? Random.default_rng() : Random.MersenneTwister(seed_val))

initial_θ = try; JuliaBUGS.getparams(model); catch; zeros(LogDensityProblems.dimension(ad_model)); end

# Sample
if n_chains > 1 && Threads.nthreads() > 1
    chain = AbstractMCMC.sample(
        rng, ld_model, NUTS(0.65), MCMCThreads(), n_samples, n_chains;
        chain_type = Chains, n_adapts = n_adapts, init_params = initial_θ,
        discard_initial = n_adapts, progress = false,
    )
elseif n_chains > 1
    chain = AbstractMCMC.sample(
        rng, ld_model, NUTS(0.65), MCMCSerial(), n_samples, n_chains;
        chain_type = Chains, n_adapts = n_adapts, init_params = initial_θ,
        discard_initial = n_adapts, progress = false,
    )
else
    chain = AbstractMCMC.sample(
        rng, ld_model, NUTS(0.65), n_samples;
        chain_type = Chains, n_adapts = n_adapts, init_params = initial_θ,
        discard_initial = n_adapts, progress = false,
    )
end

describe(chain)
