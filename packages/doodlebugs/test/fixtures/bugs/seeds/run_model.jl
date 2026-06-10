using JuliaBUGS, AbstractMCMC, AdvancedHMC, LogDensityProblems, LogDensityProblemsAD, MCMCChains, ReverseDiff, Random

data = (
  r = [10, 23, 23, 26, 17, 5, 53, 55, 32, 46, 10, 8, 10, 8, 23, 0, 3, 22, 15, 32, 3],
  n = [39, 62, 81, 51, 39, 6, 74, 72, 51, 79, 13, 16, 30, 28, 45, 4, 12, 41, 30, 51, 7],
  x1 = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
  x2 = [0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1],
  N = 21
)

inits = (
  alpha0 = 0,
  alpha1 = 0,
  alpha2 = 0,
  alpha12 = 0,
  tau = 10
)

model_def = JuliaBUGS.@bugs("""
model {
  for (i in 1:N) {
    b[i] ~ dnorm(0.0, tau)
    r[i] ~ dbin(p[i], n[i])
    p[i] <- ilogit(alpha0 + alpha1 * x1[i] + alpha2 * x2[i] + alpha12 * x1[i] * x2[i] + b[i])
  }
  alpha0 ~ dnorm(0.0, 1.0E-6)
  alpha1 ~ dnorm(0.0, 1.0E-6)
  alpha2 ~ dnorm(0.0, 1.0E-6)
  alpha12 ~ dnorm(0.0, 1.0E-6)
  tau ~ dgamma(0.001, 0.001)
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
