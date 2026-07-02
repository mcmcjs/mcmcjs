using JuliaBUGS
using ADTypes, Mooncake
using AbstractMCMC, AdvancedHMC, FlexiChains
using Random<%= censoredImport %>

data = <%= dataLiteral %>

inits = <%= initsLiteral %>
<%= censoredPrimitive %>
model_def = JuliaBUGS.@bugs("""
<%= modelCode %>
""", true, false)

<%= modelSetup %>
n_samples, n_adapts = <%= nSamples %>, <%= nAdapts %>
n_chains = <%= nChains %>
seed = <%= seedLiteral %>

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
