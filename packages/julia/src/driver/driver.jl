# MCMC.js fit driver. Reads a run-request JSON, runs Turing inference, and writes
# the draws as MCMCChains-JSON (the @mcmcjs/core samples artifact). On success a
# single line of provenance JSON is printed to stdout; failures print one-line
# JSON to stderr ({error, stage}) and exit nonzero. This is the only place that
# touches Turing's chain type, so a chain-type change is contained here.
using JSON
using Random
using StableRNGs
using Turing
using MCMCChains
using SHA
using Pkg

function build_sampler(sampler)
    algorithm = get(sampler, "algorithm", "NUTS")
    algorithm == "NUTS" || error("unsupported sampler algorithm: $algorithm")
    warmup = Int(get(sampler, "warmup", 1000))
    adapt_delta = Float64(get(sampler, "adapt_delta", 0.8))
    return NUTS(warmup, adapt_delta)
end

to_namedtuple(data) = (; (Symbol(k) => v for (k, v) in data)...)

# Build the model and sample in one call so both run in the latest world age:
# the model methods are defined by `include` at runtime, so a plain call from
# this (older) world would fail with "method too new". invokelatest fixes that.
function build_and_sample(entry, data, sampler, draws, chains, rng)
    model = entry(data)
    # Sample into Turing's default chain type (a FlexiChain), then convert to
    # MCMCChains for serialization.
    chn = sample(rng, model, sampler, MCMCSerial(), draws, chains; progress = false)
    return MCMCChains.Chains(chn)
end

# Build the exact wire object parseMCMCChainsJson consumes: value_flat is indexed
# i + p*nIter + c*nIter*nParams (column-major over [iteration, parameter, chain]).
function chains_to_wire(chn)
    arr = Array(chn.value)
    nIter, nParams, nChains = size(arr)
    flat = Vector{Union{Float64,Nothing}}(undef, nIter * nParams * nChains)
    for c in 1:nChains, p in 1:nParams, i in 1:nIter
        v = arr[i, p, c]
        flat[i + (p - 1) * nIter + (c - 1) * nIter * nParams] = v === missing ? nothing : Float64(v)
    end
    return Dict(
        "size" => [nIter, nParams, nChains],
        "value_flat" => flat,
        "parameters" => string.(names(chn)),
        "name_map" => Dict(
            "parameters" => string.(get(chn.name_map, :parameters, Symbol[])),
            "internals" => string.(get(chn.name_map, :internals, Symbol[])),
        ),
    )
end

function provenance()
    packages = Dict{String,String}()
    for (_, info) in Pkg.dependencies()
        if info.name in ("Turing", "MCMCChains", "DynamicPPL", "AbstractMCMC") && info.version !== nothing
            packages[info.name] = string(info.version)
        end
    end
    manifest = joinpath(dirname(Base.active_project()), "Manifest.toml")
    return Dict(
        "julia_version" => string(VERSION),
        "packages" => packages,
        "manifest_sha256" => isfile(manifest) ? bytes2hex(sha256(read(manifest))) : "",
    )
end

function main()
    request = JSON.parsefile(ARGS[1])
    out = request["out"]
    stage = "compile"
    try
        Random.seed!(Int(request["seed"]))
        rng = StableRNG(Int(request["seed"]))
        data = to_namedtuple(request["data"])
        include(abspath(request["model"]["file"]))
        entry = getfield(Main, Symbol(request["model"]["entry"]))

        sampler = build_sampler(request["sampler"])
        draws = Int(request["sampler"]["draws"])
        chains = Int(get(request["sampler"], "chains", 4))

        stage = "sample"
        chn = Base.invokelatest(build_and_sample, entry, data, sampler, draws, chains, rng)

        stage = "write"
        tmp = out * ".tmp"
        open(tmp, "w") do io
            JSON.print(io, chains_to_wire(chn))
        end
        mv(tmp, out; force = true)

        println(JSON.json(provenance()))
    catch err
        println(stderr, JSON.json(Dict("error" => sprint(showerror, err), "stage" => stage)))
        exit(1)
    end
end

main()
