# MCMC.js fit library, shared by the one-shot driver (driver.jl) and the
# persistent worker (worker.jl). handle_request runs one fit or predict request
# (Turing or JuliaBUGS) and writes the draws as the @mcmcjs/core samples
# artifact (a flat JSON wire). This is the only place that touches the backend
# chain type (FlexiChains), so a chain-type change is contained here.
using JSON
using Logging
import Distributed
using Random
using StableRNGs
using Turing
using Turing: VarName
using SHA
using Pkg
# Imported (not `using`) so they do not pull `@model` etc. into Main and clash
# with Turing's exports, which would break Turing model files on include.
import JuliaBUGS
import AdvancedHMC
# Loading SliceSampling activates JuliaBUGS's extension for its derivative-free samplers.
import SliceSampling
import ForwardDiff
# Loading Mooncake activates AbstractPPL's native extension for AutoMooncake.
import Mooncake
# Loading ReverseDiff activates the DynamicPPL extension for AutoReverseDiff.
import ReverseDiff
import FlexiChains
import DimensionalData

# Workers include this file to mirror the master's definitions (ModelData, the
# helpers a deserialized model may reference) when sampling MCMCDistributed.
const FITLIB_FILE = @__FILE__

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

# A Turing model file may declare the AD backend it needs by exporting, e.g.,
# `const MCMC_DEFAULTS = (; adtype = "mooncake")`. A spec or flag adtype wins;
# the model default fills in only when the request leaves adtype unset.
function apply_model_defaults(sampler, mod)
    haskey(sampler, "adtype") && return sampler
    # Only the gradient samplers take an AD backend.
    get(sampler, "algorithm", "NUTS") in ("NUTS", "HMC", "HMCDA", "Gibbs", "External") ||
        return sampler
    Base.invokelatest(isdefined, mod, :MCMC_DEFAULTS) || return sampler
    defaults = Base.invokelatest(getfield, mod, :MCMC_DEFAULTS)
    hasproperty(defaults, :adtype) || return sampler
    merged = copy(sampler)
    merged["adtype"] = String(defaults.adtype)
    return merged
end

function build_adtype(name)
    name == "forwarddiff" && return Turing.ADTypes.AutoForwardDiff()
    name == "reversediff" && return Turing.ADTypes.AutoReverseDiff()
    name == "mooncake" && return Turing.ADTypes.AutoMooncake(; config = nothing)
    error("unsupported adtype: $name")
end

function build_sampler(sampler, modelmod = nothing)
    algorithm = get(sampler, "algorithm", "NUTS")
    # Prior draws are iid: no warmup, no adaptation. The JuliaBUGS path samples
    # ancestrally (sample_bugs_prior) instead of going through a sampler object.
    algorithm == "Prior" && return Turing.Prior(), 0
    warmup = Int(get(sampler, "warmup", 1000))
    adapt_delta = Float64(get(sampler, "adapt_delta", 0.8))
    algorithm == "MH" && return Turing.MH(), warmup
    algorithm == "ESS" && return Turing.ESS(), warmup
    algorithm == "SMC" && return Turing.SMC(), warmup
    algorithm == "PG" && return Turing.PG(Int(sampler["particles"])), warmup
    adkw = haskey(sampler, "adtype") ? (; adtype = build_adtype(sampler["adtype"])) : (;)
    algorithm == "NUTS" && return Turing.NUTS(warmup, adapt_delta; adkw...), warmup
    algorithm == "HMC" &&
        return Turing.HMC(Float64(sampler["step_size"]), Int(sampler["leapfrog_steps"]); adkw...),
        warmup
    algorithm == "HMCDA" &&
        return Turing.HMCDA(warmup, adapt_delta, Float64(sampler["lambda"]); adkw...), warmup
    algorithm == "Gibbs" && return build_gibbs(sampler, adkw, warmup), warmup
    if algorithm == "External"
        modelmod === nothing && error("the External algorithm applies to Turing models only")
        Base.invokelatest(isdefined, modelmod, :MCMC_SAMPLER) ||
            error("algorithm External needs the model file to define MCMC_SAMPLER")
        ext = Base.invokelatest(getfield, modelmod, :MCMC_SAMPLER)
        return Turing.externalsampler(ext; adkw...), warmup
    end
    error("unsupported sampler algorithm: $algorithm")
end

# One Gibbs component: the block's variables get the block's sampler. A single
# variable keys by symbol, several by tuple, matching Turing's constructor.
function block_sampler(block, adkw, warmup)
    algorithm = get(block, "algorithm", "NUTS")
    adapt_delta = Float64(get(block, "adapt_delta", 0.8))
    algorithm == "MH" && return Turing.MH()
    algorithm == "ESS" && return Turing.ESS()
    algorithm == "PG" && return Turing.PG(Int(block["particles"]))
    algorithm == "NUTS" && return Turing.NUTS(warmup, adapt_delta; adkw...)
    algorithm == "HMC" &&
        return Turing.HMC(Float64(block["step_size"]), Int(block["leapfrog_steps"]); adkw...)
    algorithm == "HMCDA" &&
        return Turing.HMCDA(warmup, adapt_delta, Float64(block["lambda"]); adkw...)
    error("unsupported Gibbs block algorithm: $algorithm")
end

function build_gibbs(sampler, adkw, warmup)
    pairs = map(sampler["blocks"]) do block
        vars = Symbol.(block["variables"])
        key = length(vars) == 1 ? vars[1] : Tuple(vars)
        key => block_sampler(block, adkw, warmup)
    end
    return Turing.Gibbs(pairs...)
end

# Extra keyword arguments for AbstractMCMC.sample, from the request's sampler
# table: thinning, burn-in for the non-adaptive samplers (NUTS and HMCDA discard
# their own adaptation), and named starting values replicated across chains.
function sampling_kwargs(sampler, warmup, chains)
    kw = (;)
    thin = Int(get(sampler, "thin", 1))
    thin > 1 && (kw = merge(kw, (; thinning = thin)))
    algorithm = get(sampler, "algorithm", "NUTS")
    if algorithm in ("MH", "HMC", "ESS", "PG", "Gibbs", "External") && warmup > 0
        kw = merge(kw, (; discard_initial = warmup))
    end
    # AdvancedHMC-style external samplers adapt only when told how many steps to
    # use; without n_adapts a chain can freeze at its initial point.
    if algorithm == "External" && warmup > 0
        kw = merge(kw, (; n_adapts = warmup))
    end
    # NUTS/HMCDA blocks inside Gibbs adapt only through the sample-level nadapts
    # keyword (the constructor's count is ignored there); without it the block
    # never tunes its step size and can freeze.
    if algorithm == "Gibbs" && warmup > 0
        blocks = get(sampler, "blocks", Any[])
        if any(get(b, "algorithm", "NUTS") in ("NUTS", "HMCDA") for b in blocks)
            kw = merge(kw, (; nadapts = warmup))
        end
    end
    if haskey(sampler, "initial_params")
        nt = (; (Symbol(k) => narrow(v) for (k, v) in sampler["initial_params"])...)
        strategy = Turing.DynamicPPL.InitFromParams(nt)
        kw = merge(kw, (; initial_params = fill(strategy, chains)))
    end
    return kw
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

# A blanked target compiles to a latent node; JuliaBUGS drops scalar missings.
bugs_predict_namedtuple(data) = (; (Symbol(k) => narrow(to_missing(v)) for (k, v) in data)...)

# Rebuild a posterior VNChain (latents only) from our samples wire so it can feed
# Turing's predict. Scalar leaves are regrouped into their array-valued VarName
# (theta[1..8] -> @varname(theta) holding an 8-vector), so predict matches the
# model's parameters exactly instead of relying on leaf reconstruction. Target
# outcome columns are excluded.
function wire_to_vnchain(wire, targets)
    sz = wire["size"]
    nIter, total, nChains = Int(sz[1]), Int(sz[2]), Int(sz[3])
    flat = wire["value_flat"]
    index = Dict(n => i for (i, n) in enumerate(wire["parameters"]))
    is_target(n) = any(t -> n == t || startswith(n, t * "["), targets)
    keep = [n for n in wire["name_map"]["parameters"] if !is_target(n)]
    cell(name, i, c) = begin
        p = index[name]
        v = flat[i + (p - 1) * nIter + (c - 1) * nIter * total]
        v === nothing ? NaN : Float64(v)
    end
    base_of(n) = (b = findfirst('[', n); b === nothing ? n : n[1:prevind(n, b)])
    idx_of(n) = begin
        b = findfirst('[', n)
        b === nothing && return Int[]
        inner = n[nextind(n, b):prevind(n, findlast(']', n))]
        parse.(Int, split(inner, ','))
    end
    groups = Dict{String,Vector{String}}()
    for n in keep
        push!(get!(groups, base_of(n), String[]), n)
    end
    dict = Dict{FlexiChains.ParameterOrExtra{<:VarName},Array}()
    for (base, names) in groups
        vn = eval(:(Turing.@varname($(Meta.parse(base)))))
        if length(names) == 1 && isempty(idx_of(names[1]))
            m = Matrix{Float64}(undef, nIter, nChains)
            for c in 1:nChains, i in 1:nIter
                m[i, c] = cell(names[1], i, c)
            end
            dict[FlexiChains.Parameter(vn)] = m
        else
            idxs = [idx_of(n) for n in names]
            D = length(idxs[1])
            dims = ntuple(d -> maximum(ix[d] for ix in idxs), D)
            m = Matrix{Array{Float64,D}}(undef, nIter, nChains)
            for c in 1:nChains, i in 1:nIter
                a = Array{Float64,D}(undef, dims...)
                for (n, ix) in zip(names, idxs)
                    a[ix...] = cell(n, i, c)
                end
                m[i, c] = a
            end
            dict[FlexiChains.Parameter(vn)] = m
        end
    end
    return FlexiChains.FlexiChain{VarName}(nIter, nChains, dict)
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
function build_and_sample(
    entry, data, sampler, draws, chains, rng; callback = nothing, extra = (;), parallel = "serial"
)
    model = condition_on_data(entry(data), data)
    kw = callback === nothing ? extra : merge(extra, (; callback))
    ensemble = parallel == "threads" ? MCMCThreads() :
        parallel == "distributed" ? MCMCDistributed() : MCMCSerial()
    return Logging.with_logger(JSONProgressLogger()) do
        sample(rng, model, sampler, ensemble, draws, chains; progress = true, kw...)
    end
end

# Distributed chains need the model's definitions on every process: workers get
# this file (ModelData and friends), then all processes include the model file
# into Main so the serialized model's references resolve identically everywhere.
function setup_distributed(chains, model_file)
    missing_workers = chains - Distributed.nworkers()
    if Distributed.nprocs() == 1 || missing_workers > 0
        Distributed.addprocs(
            Distributed.nprocs() == 1 ? chains : missing_workers;
            exeflags = ["--project=$(Base.active_project())", "--startup-file=no"],
        )
        Distributed.remotecall_eval(
            Main, Distributed.workers(), :(Base.include(Main, $FITLIB_FILE))
        )
    end
    Distributed.remotecall_eval(Main, Distributed.procs(), :(Base.include(Main, $model_file)))
end

# The internals section: one scalar column per sampler statistic, as
# (name, (iter, chain) -> value) pairs. An array-valued statistic (a slice
# sampler reports a proposal count per coordinate) splits into name[i] columns
# the way array parameters do, so nothing the sampler reported is dropped.
function extra_columns(chn)
    cols = Tuple{String,Function}[]
    for e in FlexiChains.extras(chn)
        m = chn[e]
        name = string(Symbol(e))
        if eltype(m) <: Union{Missing,Real}
            push!(cols, (name, (i, c) -> m[i, c]))
        elseif eltype(m) <: AbstractArray && eltype(eltype(m)) <: Union{Missing,Real}
            for idx in eachindex(m[1, 1])
                push!(cols, ("$name[$idx]", (i, c) -> m[i, c][idx]))
            end
        end
    end
    return cols
end

# FlexiChains-native wire writer. DimArray(chn) splits array-valued parameters
# into scalar leaves (theta -> theta[1], theta[2]) in the (iter, chain, param)
# orientation; the sampler's statistics become the internals section.
function vnchain_to_wire(chn)
    da = DimensionalData.DimArray(chn)
    pnames = string.(collect(DimensionalData.lookup(da, :param)))
    arr = parent(da)
    nIter, nChains, nParams = size(arr)

    extras = extra_columns(chn)
    enames = first.(extras)
    total = nParams + length(extras)

    flat = Vector{Union{Float64,Nothing}}(undef, nIter * total * nChains)
    # JSON has no Inf/NaN; a non-finite draw (e.g. 1/sqrt(tau) under a diffuse
    # prior) becomes null, which the samples parser reads back as NaN.
    cell(v) = v === missing || !isfinite(v) ? nothing : Float64(v)
    for c in 1:nChains, p in 1:nParams, i in 1:nIter
        flat[i + (p - 1) * nIter + (c - 1) * nIter * total] = cell(arr[i, c, p])
    end
    for (k, (_, draw)) in enumerate(extras)
        p = nParams + k
        for c in 1:nChains, i in 1:nIter
            flat[i + (p - 1) * nIter + (c - 1) * nIter * total] = cell(draw(i, c))
        end
    end

    return Dict(
        "size" => [nIter, total, nChains],
        "value_flat" => flat,
        "parameters" => vcat(pnames, enames),
        "name_map" => Dict("parameters" => pnames, "internals" => enames),
    )
end

# A BUGSModel carries its own `base_model` field (the unconditioned model, or
# nothing), so unwrapping has to test the wrapper's type, not for the field.
base_bugs(model) = model isa JuliaBUGS.BUGSModelWithGradient ? model.base_model : model

# JuliaBUGS samplers that propose in the evaluation environment, so they move the
# discrete latents themselves rather than needing them summed out.
const ENV_BASED_BUGS_SAMPLERS = ("MH", "Gibbs")

# Switches a model to the evaluation mode the spec names. The generated and
# marginalized modes read parameters in unconstrained space, so both need a
# transformed model first. invokelatest is needed because JuliaBUGS `Core.eval`s
# the model's node functions while compiling, putting them in a newer world than
# this frame; the generated mode `Core.eval`s a log-density function here too.
function set_bugs_mode(model, name)
    name == "graph" &&
        return Base.invokelatest(JuliaBUGS.set_evaluation_mode, model, JuliaBUGS.UseGraph())
    mode = name == "generated" ? JuliaBUGS.UseGeneratedLogDensityFunction() :
        name == "marginalized" ? JuliaBUGS.UseAutoMarginalization() :
        error("unsupported evaluation mode: $name")
    return Base.invokelatest(
        JuliaBUGS.set_evaluation_mode, JuliaBUGS.settrans(model, true), mode,
    )
end

# Named starting values, in constrained space, as the spec records them.
# `initialize!` ignores a name it does not recognise, so an unknown one is an
# error here rather than a silent no-op.
function initialize_bugs_model(model, sampler)
    haskey(sampler, "initial_params") || return model
    known = Set(
        String(JuliaBUGS.AbstractPPL.getsym(vn)) for vn in JuliaBUGS.model_parameters(model)
    )
    for name in keys(sampler["initial_params"])
        name in known ||
            error("initial_params names $name, which is not a parameter of this model")
    end
    return Base.invokelatest(
        JuliaBUGS.initialize!, model, bugs_namedtuple(sampler["initial_params"]),
    )
end

# An environment-based sampler starts from the model's evaluation environment and
# accepts on `logp_proposed - logp_current`, which is NaN when both are -Inf: from
# an impossible starting point the chain can never move. Say so, with the fix,
# rather than return draws that never left the start.
function check_bugs_start(model, sampler)
    logp = try
        last(Base.invokelatest(JuliaBUGS.AbstractPPL.evaluate!!, model))
    catch
        -Inf
    end
    isfinite(logp) && return model
    detail = haskey(sampler, "initial_params") ?
        "the given initial_params have zero probability under the model" :
        "the model's default starting values have zero probability under the data; " *
        "set [sampler.initial_params] to a state the data allows"
    return error("$(get(sampler, "algorithm", "MH")) cannot start: $detail")
end

# Applies the request's options to a compiled model: the spec's evaluation mode
# over whatever the model file chose, the initial values, and the AD backend. The
# gradient wrapper holds a prepared gradient over one base model, so it is rebuilt
# whenever the base changes.
function prepare_bugs_model(model, sampler, mode_name)
    base = base_bugs(model)
    if get(sampler, "algorithm", "NUTS") in ENV_BASED_BUGS_SAMPLERS
        # Marginalizing would sum out the very latents these samplers propose, so
        # they always run against the plain model under graph evaluation.
        base = initialize_bugs_model(set_bugs_mode(base, "graph"), sampler)
        return check_bugs_start(base, sampler)
    end
    mode_name === nothing || (base = set_bugs_mode(base, mode_name))
    base = initialize_bugs_model(base, sampler)
    # A derivative-free sampler wants the plain model: preparing a gradient it
    # never calls costs a compile, which for Mooncake runs into minutes.
    get(sampler, "algorithm", "NUTS") == "Slice" && return base
    adtype = haskey(sampler, "adtype") ? build_adtype(sampler["adtype"]) :
        model isa JuliaBUGS.BUGSModelWithGradient ? model.adtype :
        Turing.ADTypes.AutoForwardDiff()
    return Base.invokelatest(JuliaBUGS.BUGSModelWithGradient, base, adtype)
end

# AdvancedHMC starts from a fresh draw unless handed a starting vector, so an
# initialized model's values reach a gradient sampler through this. The
# environment-based samplers start from the model's own environment, which
# `initialize!` has already set.
function bugs_initial_params(model, sampler)
    haskey(sampler, "initial_params") || return nothing
    get(sampler, "algorithm", "NUTS") in ENV_BASED_BUGS_SAMPLERS && return nothing
    return Base.invokelatest(JuliaBUGS.getparams, base_bugs(model))
end

# The AdvancedHMC sampler for a NUTS/HMC/HMCDA configuration, whole or per Gibbs
# block; nothing for any other algorithm. Adaptation runs off `sample`'s n_adapts,
# so no constructor here takes a step count.
function bugs_hmc_sampler(conf)
    algorithm = get(conf, "algorithm", "NUTS")
    adapt_delta = Float64(get(conf, "adapt_delta", 0.8))
    algorithm == "NUTS" && return AdvancedHMC.NUTS(adapt_delta)
    algorithm == "HMC" &&
        return AdvancedHMC.HMC(Float64(conf["step_size"]), Int(conf["leapfrog_steps"]))
    algorithm == "HMCDA" && return AdvancedHMC.HMCDA(adapt_delta, Float64(conf["lambda"]))
    return nothing
end

# SliceSampling's univariate samplers move one coordinate at a time, so a
# multi-parameter target needs a multivariate strategy around them. RandPermGibbs
# cycles the coordinates in a random order, and reduces to the plain univariate
# update when a Gibbs block leaves only one.
function bugs_slice_sampler(conf)
    width = Float64(conf["slice_width"])
    return SliceSampling.RandPermGibbs(SliceSampling.SliceSteppingOut(width))
end

# The support of each variable, as `Gibbs` itself classifies it. The stored value
# does not say: JuliaBUGS keeps a latent count in a Float64 array, so a count
# reads as continuous and would draw a Gaussian proposal it cannot represent.
function bugs_node_types(model)
    gd = model.graph_evaluation_data
    return Dict(zip(gd.sorted_nodes, Base.invokelatest(JuliaBUGS.Model._compute_node_types, model)))
end

# A Gaussian step never lands on an integer, so a block of counts gets a lattice
# walk. `Gibbs` draws a finite discrete block exactly instead, whatever it is
# given here.
function bugs_mh_kernel(model, vns, node_types)
    expanded = JuliaBUGS.expand_variables(vns, model.graph_evaluation_data.model_parameters)
    all(vn -> get(node_types, vn, :continuous) === :discrete_infinite, expanded) ||
        return JuliaBUGS.AdvancedMH.RobustAdaptiveMetropolis()
    return JuliaBUGS.AdvancedMH.RWMH([DiscreteUniform(-1, 1) for _ in expanded])
end

# One block per parameter, each with the kernel its own support calls for. The
# convenience `Gibbs(model, sampler)` gives every block the same one.
function bugs_single_site_mh(model)
    node_types = bugs_node_types(model)
    pairs = [
        vn => bugs_mh_kernel(model, [vn], node_types) for
        vn in JuliaBUGS.model_parameters(model)
    ]
    return JuliaBUGS.Gibbs(model, JuliaBUGS.OrderedDict(pairs))
end

bugs_varname(name) = eval(:(Turing.@varname($(Meta.parse(name)))))

# One spec block becomes one entry of JuliaBUGS's sampler map, keyed by the
# block's variables together; gradient blocks must carry their AD backend as a
# tuple. JuliaBUGS checks that the map covers every parameter exactly once.
function build_bugs_gibbs(sampler, model)
    adtype = build_adtype(get(sampler, "adtype", "forwarddiff"))
    node_types = bugs_node_types(model)
    pairs = map(sampler["blocks"]) do block
        vars = [bugs_varname(v) for v in block["variables"]]
        key = length(vars) == 1 ? vars[1] : vars
        algorithm = get(block, "algorithm", "NUTS")
        component = algorithm == "MH" ? bugs_mh_kernel(model, vars, node_types) :
            algorithm == "Slice" ? bugs_slice_sampler(block) :
            (bugs_hmc_sampler(block), adtype)
        key => component
    end
    return JuliaBUGS.Gibbs(model, JuliaBUGS.OrderedDict(pairs))
end

# Unlike the Turing path this needs the model: JuliaBUGS's Gibbs validates its
# sampler map against the model's parameters as it is constructed.
function build_bugs_sampler(sampler, model)
    hmc = bugs_hmc_sampler(sampler)
    hmc === nothing || return hmc
    algorithm = get(sampler, "algorithm", "NUTS")
    algorithm == "Slice" && return bugs_slice_sampler(sampler)
    # Single-site Metropolis over every parameter: the WinBUGS-shaped sampler, and
    # the route to discrete latents that marginalization declines.
    algorithm == "MH" && return bugs_single_site_mh(model)
    algorithm == "Gibbs" && return build_bugs_gibbs(sampler, model)
    return error("the juliabugs backend does not support the $algorithm sampler")
end

# JuliaBUGS compiles the model at runtime, so building and sampling must run in
# separate latest-world frames; merging them reintroduces a world-age error.
# Returns a FlexiChain like the Turing path; gen_chains recovers generated
# quantities (unobserved nodes with no observed descendants) after sampling.
# With a callback, draws stream (see bugs_draw_streamer).
function sample_bugs(
    model, sampler, warmup, draws, chains, rng;
    callback = nothing, thin = 1, threads = false, initial_params = nothing,
)
    kw = callback === nothing ? (;) : (; callback)
    thin > 1 && (kw = merge(kw, (; thinning = thin)))
    # Ensemble sampling wants one starting point per chain; every chain starts from
    # the values the spec named, and diverges from there through its own stream.
    initial_params === nothing ||
        (kw = merge(kw, (; initial_params = fill(initial_params, chains))))
    ensemble = threads ? JuliaBUGS.AbstractMCMC.MCMCThreads() : JuliaBUGS.AbstractMCMC.MCMCSerial()
    return Logging.with_logger(JSONProgressLogger()) do
        JuliaBUGS.AbstractMCMC.sample(
            rng, model, sampler, ensemble, draws, chains;
            chain_type = FlexiChains.VNChain, n_adapts = warmup, discard_initial = warmup,
            progress = true, kw...,
        )
    end
end

# JuliaBUGS prior sampling: each draw is one ancestral pass (evaluate!! with an
# rng samples every unobserved stochastic node from its prior and recomputes the
# deterministic ones; observed data stays fixed). The collected variables are the
# model parameters plus generated quantities, the same columns a posterior fit
# produces through gen_chains.
function sample_bugs_prior(model, draws, chains, rng)
    model = base_bugs(model)
    APPL = JuliaBUGS.AbstractPPL
    vars = vcat(JuliaBUGS.model_parameters(model), JuliaBUGS.generated_quantities(model))
    isempty(vars) && error("the model has no parameters or generated quantities to sample")
    grab(env, vn) = (v = APPL.getvalue(env, vn); v isa AbstractArray ? copy(v) : v)
    columns = Dict(vn => Vector{Any}(undef, draws * chains) for vn in vars)
    for c in 1:chains, i in 1:draws
        env, _ = APPL.evaluate!!(rng, model)
        for vn in vars
            columns[vn][i + (c - 1) * draws] = grab(env, vn)
        end
    end
    dict = Dict{FlexiChains.ParameterOrExtra{<:VarName},Array}(
        FlexiChains.Parameter(vn) =>
            [columns[vn][i + (c - 1) * draws] for i in 1:draws, c in 1:chains] for vn in vars
    )
    return FlexiChains.FlexiChain{VarName}(draws, chains, dict)
end

# The JuliaBUGS counterpart to draw_streamer. A JuliaBUGS transition carries an
# unconstrained parameter vector (or, for the environment-based samplers, an
# evaluation environment), so (unlike the Turing path) draws cannot be read off it
# directly: the generated quantities and any marginalized discrete latents are
# reconstructed only when the draws are laid out. Per batch we therefore build a
# small FlexiChain through the same bundle_transitions + vnchain_to_wire path the
# final file uses, so the streamed leaf names match the file exactly, on a copy of
# the model so reconstruction never perturbs the sampler's state. AbstractMCMC
# passes the 1-based chain index as chain_number; each chain's batches carry a
# per-chain monotonic seq.
function bugs_draw_streamer(model, sampler, draws_per_chain::Int, batch_size::Int)
    recon = deepcopy(model)
    side_rng = StableRNG(0)
    chain = Ref(-1)
    seq = Ref(0)
    transitions = Any[]
    function emit(iteration)
        isempty(transitions) && return
        chn = JuliaBUGS.bundle_transitions(
            FlexiChains.VNChain, recon, transitions, sampler; rng = side_rng,
        )
        wire = vnchain_to_wire(chn)
        nIter, total, _ = wire["size"]
        flat = wire["value_flat"]
        params = wire["parameters"]
        cols = Dict(params[p] => [flat[i + (p - 1) * nIter] for i in 1:nIter] for p in 1:total)
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
        empty!(transitions)
    end
    return function (_rng, _model, _sampler, transition, _state, iteration; chain_number = 1, _kwargs...)
        c = Int(chain_number) - 1
        if c != chain[]
            chain[] = c
            seq[] = 0
            empty!(transitions)
        end
        push!(transitions, deepcopy(transition))
        if length(transitions) >= batch_size || iteration >= draws_per_chain
            emit(iteration)
        end
    end
end

# JuliaBUGS pointwise log-likelihood: restore each posterior draw into the
# evaluation environment, recompute the deterministic nodes in topological
# order, and record logpdf per observed node. Every unobserved stochastic node
# must be covered by the posterior columns, or log p(y | theta) would not be a
# function of the draw.
function loglik_bugs(model, posterior)
    model = base_bugs(model)
    APPL = JuliaBUGS.AbstractPPL
    gd = model.graph_evaluation_data

    sz = posterior["size"]
    nIter, nCols, nChains = Int(sz[1]), Int(sz[2]), Int(sz[3])
    flat = posterior["value_flat"]
    col = Dict(n => i for (i, n) in enumerate(posterior["parameters"]))
    posterior_names = Set(posterior["name_map"]["parameters"])
    cell(i, p, c) = begin
        v = flat[i + (p - 1) * nIter + (c - 1) * nIter * nCols]
        v === nothing ? NaN : Float64(v)
    end

    restore = Tuple{APPL.VarName,Int}[]
    for vn in JuliaBUGS.model_parameters(model)
        leaves = collect(APPL.varname_leaves(vn, APPL.getvalue(model.evaluation_env, vn)))
        found = count(l -> string(l) in posterior_names, leaves)
        found == length(leaves) ||
            error("the posterior samples do not cover $(vn); were they produced by fitting this spec?")
        append!(restore, [(l, col[string(l)]) for l in leaves])
    end
    observed = [
        (vn, i) for (i, vn) in enumerate(gd.sorted_nodes) if
        gd.is_stochastic_vals[i] && gd.is_observed_vals[i]
    ]
    isempty(observed) && error("the model has no observed variables to compute a log-likelihood for")

    pnames = string.(first.(observed))
    n = length(pnames)
    flat_out = Vector{Union{Float64,Nothing}}(undef, nIter * n * nChains)
    for c in 1:nChains, i in 1:nIter
        env = model.evaluation_env
        for (leaf, p) in restore
            env = JuliaBUGS.BangBang.setindex!!(env, cell(i, p, c), leaf)
        end
        for (k, node) in enumerate(gd.sorted_nodes)
            if !gd.is_stochastic_vals[k]
                env = JuliaBUGS.BangBang.setindex!!(
                    env, gd.node_function_vals[k](env, gd.loop_vars_vals[k]), node,
                )
            end
        end
        for (k, (vn, idx)) in enumerate(observed)
            dist = gd.node_function_vals[idx](env, gd.loop_vars_vals[idx])
            v = logpdf(dist, APPL.getvalue(env, vn))
            flat_out[i + (k - 1) * nIter + (c - 1) * nIter * n] = isfinite(v) ? Float64(v) : nothing
        end
    end
    return Dict(
        "size" => [nIter, n, nChains],
        "value_flat" => flat_out,
        "parameters" => pnames,
        "name_map" => Dict("parameters" => pnames, "internals" => String[]),
    )
end

# JuliaBUGS posterior prediction: condition the (target-blanked) model on the
# posterior parameter columns, then evaluate!! ancestral-samples the remaining
# latents once per posterior draw. No sampler or gradient runs.
function predict_bugs(model, posterior, targets, rng)
    model = base_bugs(model)
    APPL = JuliaBUGS.AbstractPPL
    target_syms = Set(Symbol.(targets))
    is_target(vn) = APPL.getsym(vn) in target_syms

    sz = posterior["size"]
    nIter, nCols, nChains = Int(sz[1]), Int(sz[2]), Int(sz[3])
    flat = posterior["value_flat"]
    col = Dict(n => i for (i, n) in enumerate(posterior["parameters"]))
    posterior_names = Set(posterior["name_map"]["parameters"])
    cell(i, p, c) = begin
        v = flat[i + (p - 1) * nIter + (c - 1) * nIter * nCols]
        v === nothing ? NaN : Float64(v)
    end

    # Nodes fully covered by posterior columns are conditioned; anything
    # uncovered stays latent and is forward-sampled, like Turing.predict.
    gd = model.graph_evaluation_data
    conditioned = APPL.VarName[]
    restore = Tuple{APPL.VarName,Int}[]
    for (i, vn) in enumerate(gd.sorted_nodes)
        (gd.is_stochastic_vals[i] && !gd.is_observed_vals[i] && !is_target(vn)) || continue
        leaves = collect(APPL.varname_leaves(vn, APPL.getvalue(model.evaluation_env, vn)))
        found = count(l -> string(l) in posterior_names, leaves)
        if found == length(leaves)
            push!(conditioned, vn)
            append!(restore, [(l, col[string(l)]) for l in leaves])
        elseif found > 0
            error("the posterior samples cover $(vn) only partially; refit before predicting")
        end
    end
    isempty(conditioned) &&
        error("the posterior samples share no parameters with the model; were they produced by fitting this spec?")
    cond = APPL.condition(model, conditioned)

    any(is_target, cond.graph_evaluation_data.sorted_nodes) ||
        error("no variables predicted; check that [predict].targets name model variables")

    out_leaves = APPL.VarName[]
    arr = Array{Float64,3}(undef, 0, 0, 0)
    for c in 1:nChains, i in 1:nIter
        env = cond.evaluation_env
        for (leaf, p) in restore
            env = JuliaBUGS.BangBang.setindex!!(env, cell(i, p, c), leaf)
        end
        cond = JuliaBUGS.BangBang.setproperty!!(cond, :evaluation_env, env)
        drawn, _ = APPL.evaluate!!(rng, cond)
        if isempty(out_leaves)
            out_leaves = [
                l for vn in cond.graph_evaluation_data.sorted_nodes if is_target(vn)
                for l in APPL.varname_leaves(vn, APPL.getvalue(drawn, vn))
            ]
            arr = Array{Float64,3}(undef, nIter, length(out_leaves), nChains)
        end
        for (k, leaf) in enumerate(out_leaves)
            arr[i, k, c] = Float64(APPL.getvalue(drawn, leaf))
        end
    end

    pnames = string.(out_leaves)
    n = length(pnames)
    flat_out = Vector{Union{Float64,Nothing}}(undef, nIter * n * nChains)
    for c in 1:nChains, p in 1:n, i in 1:nIter
        v = arr[i, p, c]
        flat_out[i + (p - 1) * nIter + (c - 1) * nIter * n] = isfinite(v) ? v : nothing
    end
    return Dict(
        "size" => [nIter, n, nChains],
        "value_flat" => flat_out,
        "parameters" => pnames,
        "name_map" => Dict("parameters" => pnames, "internals" => String[]),
    )
end

function provenance()
    packages = Dict{String,String}()
    for (_, info) in Pkg.dependencies()
        if info.name in
           ("Turing", "FlexiChains", "DynamicPPL", "AbstractMCMC", "JuliaBUGS", "AdvancedHMC", "SliceSampling", "ForwardDiff", "Mooncake", "ADTypes") &&
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
# Load the user's model file into a throwaway module. Isolation keeps repeated
# requests in the persistent worker from colliding on names (e.g. two models each
# defining `const model_def`), and confines the model's globals to their own scope.
function load_model_module(path)
    mod = Module(gensym(:UserModel))
    Base.include(mod, abspath(path))
    return mod
end

function resolve_entry(mod, requested)
    for name in (requested, "build_model")
        name === nothing && continue
        sym = Symbol(name)
        # The model was just include'd, so its bindings live in a newer world than
        # this frame; resolve them in the latest world to avoid a Julia 1.12
        # world-age warning on the access.
        Base.invokelatest(isdefined, mod, sym) && return Base.invokelatest(getfield, mod, sym)
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
        modelmod = load_model_module(request["model"]["file"])
        entry = resolve_entry(modelmod, get(request["model"], "entry", nothing))

        wire = if mode == "loglik"
            if backend == "juliabugs"
                model = Base.invokelatest(entry, bugs_namedtuple(request["data"]))
                stage = "load_samples"
                posterior = JSON.parsefile(request["samples"])
                stage = "loglik"
                Base.invokelatest(loglik_bugs, model, posterior)
            else
                data = ModelData(to_namedtuple(request["data"]))
                model = Base.invokelatest(entry, data)
                model = Base.invokelatest(condition_on_data, model, data)
                stage = "load_samples"
                chn = wire_to_vnchain(JSON.parsefile(request["samples"]), String[])
                stage = "loglik"
                pll = Base.invokelatest(Turing.DynamicPPL.pointwise_loglikelihoods, model, chn)
                isempty(FlexiChains.parameters(pll)) &&
                    error("the model has no observed variables to compute a log-likelihood for")
                vnchain_to_wire(pll)
            end
        elseif mode == "predict"
            if backend == "juliabugs"
                model = Base.invokelatest(entry, bugs_predict_namedtuple(request["data"]))
                stage = "load_samples"
                posterior = JSON.parsefile(request["samples"])
                stage = "predict"
                Base.invokelatest(predict_bugs, model, posterior, request["predict"]["targets"], rng)
            else
                model = Base.invokelatest(entry, ModelData(predict_namedtuple(request["data"])))
                stage = "load_samples"
                rchn = wire_to_vnchain(JSON.parsefile(request["samples"]), request["predict"]["targets"])
                stage = "predict"
                pp = Base.invokelatest(predict, rng, model, rchn; include_all = false)
                isempty(FlexiChains.parameters(pp)) &&
                    error("no variables predicted; check that [predict].targets name unconditioned outcomes")
                vnchain_to_wire(pp)
            end
        else
            data = backend == "juliabugs" ? bugs_namedtuple(request["data"]) : ModelData(to_namedtuple(request["data"]))
            parallel = get(request["sampler"], "parallel", "serial")
            chains = Int(get(request["sampler"], "chains", 4))
            if parallel == "distributed" && backend != "juliabugs"
                # Every process needs the model's definitions under the same
                # names; the module-per-request isolation gives way to Main.
                stage = "distribute"
                Base.invokelatest(setup_distributed, chains, request["model"]["file"])
                modelmod = Main
                entry = resolve_entry(Main, get(request["model"], "entry", nothing))
            end
            sampler_conf = apply_model_defaults(request["sampler"], modelmod)
            draws = Int(request["sampler"]["draws"])
            stage = "sample"
            if backend == "juliabugs"
                model = Base.invokelatest(entry, data)
                chn = if get(sampler_conf, "algorithm", "NUTS") == "Prior"
                    Base.invokelatest(sample_bugs_prior, model, draws, chains, rng)
                else
                    model = Base.invokelatest(
                        prepare_bugs_model, model, sampler_conf,
                        get(request["model"], "evaluation_mode", nothing),
                    )
                    sampler = Base.invokelatest(build_bugs_sampler, sampler_conf, model)
                    warmup = Int(get(sampler_conf, "warmup", 1000))
                    threads = parallel == "threads"
                    # Reconstruction reads the plain BUGSModel; a gradient sampler runs wrapped.
                    cb = get(request, "stream_draws", false) && !threads ?
                        bugs_draw_streamer(
                            base_bugs(model), sampler, draws,
                            Int(get(request, "draw_batch_size", 25)),
                        ) : nothing
                    Base.invokelatest(
                        sample_bugs, model, sampler, warmup, draws, chains, rng;
                        callback = cb, thin = Int(get(request["sampler"], "thin", 1)), threads,
                        initial_params = Base.invokelatest(
                            bugs_initial_params, model, sampler_conf,
                        ),
                    )
                end
                vnchain_to_wire(chn)
            else
                sampler, warmup = build_sampler(sampler_conf, modelmod)
                # The draw streamer assumes chains arrive one at a time; with
                # concurrent chains the caller must not request streaming.
                cb = get(request, "stream_draws", false) && parallel == "serial" ?
                    draw_streamer(draws, Int(get(request, "draw_batch_size", 25))) : nothing
                extra = sampling_kwargs(request["sampler"], warmup, chains)
                chn = Base.invokelatest(
                    build_and_sample, entry, data, sampler, draws, chains, rng;
                    callback = cb, extra, parallel,
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
