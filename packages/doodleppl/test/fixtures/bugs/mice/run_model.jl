using JuliaBUGS, AbstractMCMC, AdvancedHMC, LogDensityProblems, LogDensityProblemsAD, MCMCChains, ReverseDiff, Random
using Distributions: censored

data = (
  M = 4,
  N = 20,
  t = [
        12 1 21 25 11 26 27 30 13 12 21 20 23 25 23 29 35 missing 31 36
        32 27 23 12 18 missing missing 38 29 30 missing 32 missing missing missing missing 25 30 37 27
        22 26 missing 28 19 15 12 35 35 10 22 18 missing 12 missing missing 31 24 37 29
        27 18 22 13 18 29 28 missing 16 22 26 19 missing missing 17 28 26 12 17 26
    ],
  t_cen = [
        0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 40 0 0
        0 0 0 0 0 40 40 0 0 0 40 0 40 40 40 40 0 0 0 0
        0 0 10 0 0 0 0 0 0 0 0 0 24 0 40 40 0 0 0 0
        0 0 0 0 0 0 0 20 0 0 0 0 29 10 0 0 0 0 0 0
    ]
)

inits = (
  beta = [-1, -1, -1, -1],
  r = 1
)

# Register censored() as a valid BUGS primitive
JuliaBUGS.@bugs_primitive censored

model_def = JuliaBUGS.@bugs("""
model {
  for (i in 1:M) {
    for (j in 1:N) {
      t[i,j] ~ dweib(r, mu[i])C(t.cen[i, j],)
    }
    beta[i] ~ dnorm(0.0, 0.001)
    mu[i] <- exp(beta[i])
    median[i] <- pow(log(2) * exp(-beta[i]), 1 / r)
  }
  r ~ dunif(0.1, 10)
  veh.control <- beta[2] - beta[1]
  test.sub <- beta[3] - beta[1]
  pos.control <- beta[4] - beta[1]
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
