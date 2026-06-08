# MCMC.js fit driver. Reads a run-request JSON, runs Turing inference, and writes
# the draws as MCMCChains-JSON (the @mcmcjs/core samples artifact). On success a
# single line of provenance JSON is printed to stdout; failures print one-line
# JSON to stderr ({error, stage}) and exit nonzero. This is the only place that
# touches Turing's chain type, so a chain-type change is contained here.
using JSON
using Random
using StableRNGs
using Turing
using Turing: VarName
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

# JSON null arrives as `nothing`; map it to `missing` so a blanked outcome becomes
# a sampling (predictive) statement in the model.
to_missing(x) = x === nothing ? missing : (x isa AbstractVector ? map(to_missing, x) : x)
predict_namedtuple(data) = (; (Symbol(k) => to_missing(v) for (k, v) in data)...)

# Rebuild a posterior Chains (latents only) from our MCMCChains-JSON wire object so
# it can feed Turing.predict. The varname_to_symbol map is required for VarName
# indexing; target outcome columns are excluded.
function chains_from_wire(wire, targets)
    sz = wire["size"]
    nIter, nParams, nChains = Int(sz[1]), Int(sz[2]), Int(sz[3])
    flat = wire["value_flat"]
    allnames = wire["parameters"]
    is_target(n) = any(t -> n == t || startswith(n, t * "["), targets)
    keep = [n for n in wire["name_map"]["parameters"] if !is_target(n)]
    index = Dict(n => i for (i, n) in enumerate(allnames))
    arr = Array{Float64,3}(undef, nIter, length(keep), nChains)
    for (newp, n) in enumerate(keep)
        p = index[n]
        for c in 1:nChains, i in 1:nIter
            v = flat[i + (p - 1) * nIter + (c - 1) * nIter * nParams]
            arr[i, newp, c] = v === nothing ? NaN : Float64(v)
        end
    end
    syms = Symbol.(keep)
    vmap = Dict{VarName,Symbol}(eval(:(Turing.@varname($(Meta.parse(n))))) => Symbol(n) for n in keep)
    return MCMCChains.Chains(arr, syms, Dict(:parameters => syms); info = (; varname_to_symbol = vmap))
end

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
    mode = get(request, "mode", "fit")
    stage = "compile"
    try
        Random.seed!(Int(request["seed"]))
        rng = StableRNG(Int(request["seed"]))
        include(abspath(request["model"]["file"]))
        entry = getfield(Main, Symbol(request["model"]["entry"]))

        wire = if mode == "predict"
            model = Base.invokelatest(entry, predict_namedtuple(request["data"]))
            stage = "load_samples"
            rchn = chains_from_wire(JSON.parsefile(request["samples"]), request["predict"]["targets"])
            stage = "predict"
            pp = Base.invokelatest(predict, rng, model, rchn)
            isempty(names(pp)) &&
                error("no variables predicted; check that [predict].targets name unconditioned outcomes")
            chains_to_wire(pp)
        else
            data = to_namedtuple(request["data"])
            sampler = build_sampler(request["sampler"])
            draws = Int(request["sampler"]["draws"])
            chains = Int(get(request["sampler"], "chains", 4))
            stage = "sample"
            chains_to_wire(Base.invokelatest(build_and_sample, entry, data, sampler, draws, chains, rng))
        end

        stage = "write"
        tmp = out * ".tmp"
        open(tmp, "w") do io
            JSON.print(io, wire)
        end
        mv(tmp, out; force = true)

        println(JSON.json(provenance()))
    catch err
        println(stderr, JSON.json(Dict("error" => sprint(showerror, err), "stage" => stage)))
        exit(1)
    end
end

main()
