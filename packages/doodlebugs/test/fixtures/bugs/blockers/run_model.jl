using JuliaBUGS, AbstractMCMC, AdvancedHMC, LogDensityProblems, LogDensityProblemsAD, MCMCChains, ReverseDiff, Random

data = (
  rt = [3, 7, 5, 102, 28, 4, 98, 60, 25, 138, 64, 45, 9, 57, 25, 33, 28, 8, 6, 32, 27, 22],
  nt = [38, 114, 69, 1533, 355, 59, 945, 632, 278, 1916, 873, 263, 291, 858, 154, 207, 251, 151, 174, 209, 391, 680],
  rc = [3, 14, 11, 127, 27, 6, 152, 48, 37, 188, 52, 47, 16, 45, 31, 38, 12, 6, 3, 40, 43, 39],
  nc = [39, 116, 93, 1520, 365, 52, 939, 471, 282, 1921, 583, 266, 293, 883, 147, 213, 122, 154, 134, 218, 364, 674],
  Num = 22
)

inits = (
  d = 0,
  delta_new = 0,
  tau = 1,
  mu = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  delta = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
)

model_def = JuliaBUGS.@bugs("""
model {
  for (i in 1:Num) {
    mu[i] ~ dnorm(0.0, 1.0E-5)
    delta[i] ~ dnorm(d, tau)
    rc[i] ~ dbin(pc[i], nc[i])
    rt[i] ~ dbin(pt[i], nt[i])
    pc[i] <- logistic(mu[i])
    pt[i] <- logistic(mu[i] + delta[i])
  }
  d ~ dnorm(0.0, 1.0E-6)
  tau ~ dgamma(0.001, 0.001)
  delta.new ~ dnorm(d, tau)
  sigma <- 1 / sqrt(tau)
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
