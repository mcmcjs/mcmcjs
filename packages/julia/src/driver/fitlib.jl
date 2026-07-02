# MCMC.js fit library, shared by the one-shot driver (driver.jl) and the
# persistent worker (worker.jl). handle_request runs one fit or predict request
# (Turing or JuliaBUGS) and writes the draws as MCMCChains-JSON (the
# @mcmcjs/core samples artifact). This is the only place that touches the
# backend chain types, so a chain-type change is contained here.
using JSON
using Logging
using Random
using StableRNGs
using Turing
using Turing: VarName
using MCMCChains
using SHA
using Pkg
# Imported (not `using`) so they do not pull `@model` etc. into Main and clash
# with Turing's exports, which would break Turing model files on include.
import JuliaBUGS
import AdvancedHMC
import ForwardDiff
import FlexiChains
import DimensionalData

# AbstractMCMC reports sampling progress through ProgressLogging (reachable via
# Turing's dependency, no extra package in the managed env).
const ProgressLogging = Turing.AbstractMCMC.ProgressLogging

# Where progress JSON lines go: the driver leaves this on stderr; the worker
# points it at the client socket for the duration of a request.
const PROGRESS_IO = Ref{IO}(stderr)

# Translates ProgressLogging records into one JSON line per update
# ({"mcmcjs":"progress",...}). The TypeScript side filters these out of the
# failure protocol's stderr buffer. Info-and-above records pass through to a
# plain console logger; Debug records (AdvancedHMC step-size search) are dropped.
struct JSONProgressLogger <: Logging.AbstractLogger
    fallback::Logging.AbstractLogger
    last::Dict{Int,Float64}
end
JSONProgressLogger() =
    JSONProgressLogger(Logging.ConsoleLogger(stderr, Logging.Info), Dict{Int,Float64}())

Logging.min_enabled_level(::JSONProgressLogger) = Logging.BelowMinLevel
Logging.shouldlog(::JSONProgressLogger, args...) = true
Logging.catch_exceptions(::JSONProgressLogger) = true

function emit_progress(logger::JSONProgressLogger, name, fraction, done)
    m = match(r"Chain (\d+) of (\d+)", String(name))
    chain = m === nothing ? 1 : parse(Int, m.captures[1])
    of = m === nothing ? 1 : parse(Int, m.captures[2])
    f = done ? 1.0 : fraction === nothing ? 0.0 : Float64(fraction)
    # AbstractMCMC already steps by 1%; the dedupe guards chattier emitters.
    if done || f - get(logger.last, chain, -1.0) >= 0.01
        logger.last[chain] = f
        println(
            PROGRESS_IO[],
            JSON.json(
                Dict(
                    "mcmcjs" => "progress",
                    "chain" => chain,
                    "of" => of,
                    "fraction" => round(f; digits = 4),
                    "done" => done,
                ),
            ),
        )
        flush(PROGRESS_IO[])
    end
end

function Logging.handle_message(
    logger::JSONProgressLogger, level, message, _module, group, id, file, line; kwargs...
)
    progress = message isa ProgressLogging.ProgressString ? message.progress :
        message isa ProgressLogging.Progress ? message : nothing
    if progress !== nothing
        emit_progress(logger, progress.name, progress.fraction, progress.done)
        return
    end
    if haskey(kwargs, :progress) && (kwargs[:progress] isa Real || kwargs[:progress] == "done")
        value = kwargs[:progress]
        emit_progress(logger, string(message), value == "done" ? nothing : value, value == "done")
        return
    end
    level >= Logging.Info || return
    Logging.handle_message(logger.fallback, level, message, _module, group, id, file, line; kwargs...)
end

function build_sampler(sampler, backend)
    algorithm = get(sampler, "algorithm", "NUTS")
    algorithm == "NUTS" || error("unsupported sampler algorithm: $algorithm")
    warmup = Int(get(sampler, "warmup", 1000))
    adapt_delta = Float64(get(sampler, "adapt_delta", 0.8))
    nuts = backend == "juliabugs" ? AdvancedHMC.NUTS(adapt_delta) : Turing.NUTS(warmup, adapt_delta)
    return nuts, warmup
end

to_namedtuple(data) = (; (Symbol(k) => v for (k, v) in data)...)

# Binds the data so a model can read a variable as a property (`data.y`) or by
# index (`data["y"]` / `data[:y]`), with `haskey`/`keys` supported, so models
# written in either idiom run unchanged. The underlying NamedTuple is reached
# via getfield to avoid colliding with a data variable also named `nt`.
struct ModelData
    nt::NamedTuple
end
Base.getproperty(d::ModelData, k::Symbol) = getproperty(getfield(d, :nt), k)
Base.getindex(d::ModelData, k::Symbol) = getproperty(getfield(d, :nt), k)
Base.getindex(d::ModelData, k::AbstractString) = getproperty(getfield(d, :nt), Symbol(k))
Base.haskey(d::ModelData, k::Symbol) = haskey(getfield(d, :nt), k)
Base.haskey(d::ModelData, k::AbstractString) = haskey(getfield(d, :nt), Symbol(k))
Base.keys(d::ModelData) = keys(getfield(d, :nt))
Base.propertynames(d::ModelData) = propertynames(getfield(d, :nt))

# JuliaBUGS requires dense arrays with a concrete numeric eltype, but JSON parses
# them as Vector{Any} (and nested arrays as vectors of vectors). narrow promotes a
# numeric array to a concrete eltype and stacks equal-sized nested arrays into a
# dense array; an empty array becomes Float64[].
function narrow(v::AbstractVector)
    isempty(v) && return Float64[]
    elems = [narrow(x) for x in v]
    if all(e -> e isa AbstractArray, elems) && allequal(size.(elems))
        return stack(elems; dims = 1)
    end
    return eltype(elems) <: Real && !isconcretetype(eltype(elems)) ? float.(elems) : elems
end
narrow(x) = x
bugs_namedtuple(data) = (; (Symbol(k) => narrow(v) for (k, v) in data)...)

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

# Expand one sampler transition to canonical scalar leaves (theta -> theta[1], ...),
# the same names the final samples file uses, so streamed batches reconstruct it.
# Sampler statistics (acceptance rate, tree depth, ...) ride along under the same
# names the samples file records as internals, so consumers get per-draw
# diagnostics without a second channel; Bool stats become 0/1.
function flatten_draw(transition)
    out = Pair{String,Float64}[]
    for (vn, val) in pairs(transition.params)
        for (leaf, leafval) in Turing.DynamicPPL.varname_and_value_leaves(vn, val)
            push!(out, string(leaf) => Float64(leafval))
        end
    end
    if hasproperty(transition, :stats)
        for (name, value) in pairs(transition.stats)
            value isa Real && push!(out, string(name) => Float64(value))
        end
    end
    return out
end

# A per-draw callback that emits {"mcmcjs":"draws",...} batches on PROGRESS_IO as
# sampling proceeds. AbstractMCMC passes the 1-based chain index as `chain_number`;
# each batch carries a per-chain monotonic seq, and a chain's batches concatenate
# (by leaf name) to the final samples file. Assumes the callback is not invoked
# concurrently across chains (true for the MCMCSerial path build_and_sample uses).
function draw_streamer(draws_per_chain::Int, batch_size::Int)
    chain = Ref(-1)
    seq = Ref(0)
    names = String[]
    buffer = Dict{String,Vector{Float64}}()
    filled = Ref(0)
    function emit(iteration)
        filled[] == 0 && return
        cols = Dict{String,Vector{Float64}}(n => copy(buffer[n]) for n in names)
        println(
            PROGRESS_IO[],
            JSON.json(
                Dict(
                    "mcmcjs" => "draws",
                    "chain" => chain[],
                    "seq" => seq[],
                    "iteration" => iteration,
                    "draws" => cols,
                ),
            ),
        )
        flush(PROGRESS_IO[])
        seq[] += 1
        for n in names
            empty!(buffer[n])
        end
        filled[] = 0
    end
    return function (_rng, _model, _sampler, transition, _state, iteration; chain_number = 1, _kwargs...)
        c = Int(chain_number) - 1
        if c != chain[]
            chain[] = c
            seq[] = 0
        end
        leaves = flatten_draw(transition)
        if isempty(names)
            for (n, _) in leaves
                push!(names, n)
                buffer[n] = Float64[]
            end
        end
        for (n, v) in leaves
            push!(get!(buffer, n, Float64[]), v)
        end
        filled[] += 1
        if filled[] >= batch_size || iteration >= draws_per_chain
            emit(iteration)
        end
    end
end

# Turing observes a variable only when its name is a model argument. A dict-reading
# model (`y = data["y"]; y[i] ~ dist`) would otherwise SAMPLE its outcome instead of
# observing it, so condition the built model on the data columns to turn each such
# `~` into an observation. Columns that are already model arguments are skipped: they
# are observed by construction, and conditioning one that is also an argument errors.
# Do not probe the model to find latent columns (e.g. via VarInfo): evaluating a
# dict-reading model assigns prior draws into the array the data is read from,
# corrupting it before we condition. Predictor columns carry no `~`, so conditioning
# on them is a harmless no-op.
function condition_on_data(model, data)
    nt = data isa ModelData ? getfield(data, :nt) : data
    nt isa NamedTuple || return model
    argnames = keys(model.args)
    pairs = [k => getproperty(nt, k) for k in keys(nt) if Base.isidentifier(string(k)) && !(k in argnames)]
    isempty(pairs) && return model
    return Turing.DynamicPPL.condition(model, (; pairs...))
end

# Build the model and sample in one call so both run in the latest world age:
# the model methods are defined by `include` at runtime, so a plain call from
# this (older) world would fail with "method too new". invokelatest fixes that.
# Returns Turing's default chain type, a FlexiChain. With a callback, draws stream.
function build_and_sample(entry, data, sampler, draws, chains, rng; callback = nothing)
    model = condition_on_data(entry(data), data)
    kw = callback === nothing ? NamedTuple() : (; callback)
    return Logging.with_logger(JSONProgressLogger()) do
        sample(rng, model, sampler, MCMCSerial(), draws, chains; progress = true, kw...)
    end
end

# FlexiChains-native wire writer. DimArray(chn) splits array-valued parameters
# into scalar leaves (theta -> theta[1], theta[2]) in the (iter, chain, param)
# orientation; Real-valued extras become the internals section, matching what
# the MCMCChains bridge produced.
function vnchain_to_wire(chn)
    da = DimensionalData.DimArray(chn)
    pnames = string.(collect(DimensionalData.lookup(da, :param)))
    arr = parent(da)
    nIter, nChains, nParams = size(arr)

    extras = [e for e in FlexiChains.extras(chn) if eltype(chn[e]) <: Union{Missing,Real}]
    enames = [string(Symbol(e)) for e in extras]
    total = nParams + length(extras)

    flat = Vector{Union{Float64,Nothing}}(undef, nIter * total * nChains)
    cell(v) = v === missing ? nothing : Float64(v)
    for c in 1:nChains, p in 1:nParams, i in 1:nIter
        flat[i + (p - 1) * nIter + (c - 1) * nIter * total] = cell(arr[i, c, p])
    end
    for (k, e) in enumerate(extras)
        m = chn[e]
        p = nParams + k
        for c in 1:nChains, i in 1:nIter
            flat[i + (p - 1) * nIter + (c - 1) * nIter * total] = cell(m[i, c])
        end
    end

    return Dict(
        "size" => [nIter, total, nChains],
        "value_flat" => flat,
        "parameters" => vcat(pnames, enames),
        "name_map" => Dict("parameters" => pnames, "internals" => enames),
    )
end

# JuliaBUGS compiles the model at runtime, so building and sampling must run in
# separate latest-world frames; merging them reintroduces a world-age error. The
# result is already an MCMCChains.Chains, so it is not re-wrapped.
function sample_bugs(model, sampler, warmup, draws, chains, rng)
    return Logging.with_logger(JSONProgressLogger()) do
        JuliaBUGS.AbstractMCMC.sample(
            rng, model, sampler, JuliaBUGS.AbstractMCMC.MCMCSerial(), draws, chains;
            chain_type = MCMCChains.Chains, n_adapts = warmup, discard_initial = warmup, progress = true,
        )
    end
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
        if info.name in
           ("Turing", "FlexiChains", "MCMCChains", "DynamicPPL", "AbstractMCMC", "JuliaBUGS", "AdvancedHMC", "ForwardDiff", "ADTypes") &&
           info.version !== nothing
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

# Resolve the model entry function: use the requested name, falling back to the
# conventional build_model. This lets a request leave the entry implicit, or name a
# custom entry that a given model file does not define (then build_model is used).
function resolve_entry(mod, requested)
    for name in (requested, "build_model")
        name === nothing && continue
        sym = Symbol(name)
        isdefined(mod, sym) && return getfield(mod, sym)
    end
    error("model file defines no entry function (looked for $(requested) and build_model)")
end

# Runs one request end to end. Returns {"ok": true, "provenance": ...} or
# {"ok": false, "error": ..., "stage": ...}; never throws.
function handle_request(request)
    out = request["out"]
    mode = get(request, "mode", "fit")
    backend = get(get(request, "backend", Dict()), "id", "turing")
    stage = "compile"
    try
        Random.seed!(Int(request["seed"]))
        rng = StableRNG(Int(request["seed"]))
        Base.include(Main, abspath(request["model"]["file"]))
        entry = resolve_entry(Main, get(request["model"], "entry", nothing))

        wire = if mode == "predict"
            backend == "turing" || error("predict is not yet supported for backend $backend")
            model = Base.invokelatest(entry, ModelData(predict_namedtuple(request["data"])))
            stage = "load_samples"
            rchn = chains_from_wire(JSON.parsefile(request["samples"]), request["predict"]["targets"])
            stage = "predict"
            pp = Base.invokelatest(predict, rng, model, rchn)
            isempty(names(pp)) &&
                error("no variables predicted; check that [predict].targets name unconditioned outcomes")
            chains_to_wire(pp)
        else
            data = backend == "juliabugs" ? bugs_namedtuple(request["data"]) : ModelData(to_namedtuple(request["data"]))
            sampler, warmup = build_sampler(request["sampler"], backend)
            draws = Int(request["sampler"]["draws"])
            chains = Int(get(request["sampler"], "chains", 4))
            stage = "sample"
            if backend == "juliabugs"
                model = Base.invokelatest(entry, data)
                chn = Base.invokelatest(sample_bugs, model, sampler, warmup, draws, chains, rng)
                chains_to_wire(chn)
            else
                cb = get(request, "stream_draws", false) ?
                    draw_streamer(draws, Int(get(request, "draw_batch_size", 25))) : nothing
                chn = Base.invokelatest(
                    build_and_sample, entry, data, sampler, draws, chains, rng; callback = cb,
                )
                vnchain_to_wire(chn)
            end
        end

        stage = "write"
        tmp = out * ".tmp"
        open(tmp, "w") do io
            JSON.print(io, wire)
        end
        mv(tmp, out; force = true)

        return Dict("ok" => true, "provenance" => provenance())
    catch err
        return Dict("ok" => false, "error" => sprint(showerror, err), "stage" => stage)
    end
end
