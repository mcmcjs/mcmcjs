using JuliaBUGS, AbstractMCMC, AdvancedHMC, LogDensityProblems, LogDensityProblemsAD, MCMCChains, ReverseDiff, Random

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
