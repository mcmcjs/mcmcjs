using JuliaBUGS
using ADTypes, Mooncake
using AbstractMCMC, AdvancedHMC, FlexiChains
using Random

data = (
  N = 10,
  P = 2,
  group = [1, 1, -1, -1, -1, 1, 1, 1, -1, -1],
  Y = [
        1.4 1.65
        1.64 1.57
        1.44 1.58
        1.36 1.68
        1.65 1.69
        1.08 1.31
        1.09 1.43
        1.25 1.44
        1.25 1.39
        1.3 1.52
    ],
  sign = [1, -1]
)

inits = (
  mu = 0,
  phi = 0,
  pi = 0,
  tau1 = 1,
  tau2 = 1
)

model_def = JuliaBUGS.@bugs("""
model {
  for (k in 1:P) {
    for (i in 1:N) {
      Y[i,k] ~ dnorm(m[i, k], tau1)
      T[i,k] <- group[i] * (k - 1.5) + 1.5
      m[i,k] <- mu + sign[T[i, k]] * phi / 2 + sign[k] * pi / 2 + delta[i]
    }
  }
  for (i in 1:N) {
    delta[i] ~ dnorm(0.0, tau2)
  }
  mu ~ dnorm(0.0, 1.0E-6)
  phi ~ dnorm(0.0, 1.0E-6)
  pi ~ dnorm(0.0, 1.0E-6)
  tau1 ~ dgamma(0.001, 0.001)
  tau2 ~ dgamma(0.001, 0.001)
  theta <- exp(phi)
  sigma1 <- 1 / sqrt(tau1)
  sigma2 <- 1 / sqrt(tau2)
  equiv <- step(theta - 0.8) - step(theta - 1.2)
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
