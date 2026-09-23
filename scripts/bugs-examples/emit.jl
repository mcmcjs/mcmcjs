#!/usr/bin/env julia
#
# Writes each registered example out as a model file, a data file, a run spec, and a
# shell script that fits them with the mcmcjs CLI and exports one self-contained run
# bundle per example. The bundles can then be hosted anywhere and opened in the report
# app at https://mcmcjs.github.io/report/#bundle=<url>.
#
# Reads the examples out of a JuliaBUGS checkout, so it runs against that project's
# environment rather than this one. bugs-bundles.yml does the checkout; to run it by
# hand, point --project at a clone. Fitting is a separate slow step:
#
#     julia --project=<juliabugs>/JuliaBUGS scripts/bugs-examples/emit.jl out/
#     julia --project=<juliabugs>/JuliaBUGS scripts/bugs-examples/emit.jl out/ volume_1
#     julia --project=<juliabugs>/JuliaBUGS scripts/bugs-examples/emit.jl out/ rats
#     sh out/run.sh
#
# Sampler settings follow what the OpenBUGS documentation reports for these examples,
# "a 1000 update burn in followed by a further 10000 updates", over the two chains its
# two sets of initial values imply. Thinning by 10 keeps 1000 of those 10000 draws,
# which is what holds a bundle under the size the report app will fetch; the sampling
# effort is unchanged. Note that JuliaBUGS samples with NUTS where OpenBUGS used Gibbs,
# so posterior means should agree but Monte Carlo error will not.
#
# Each example is compiled once here to decide how it has to be fitted: which of its
# published initial values name parameters, whether it has discrete parameters that
# NUTS needs summed out, and whether anything continuous is left to sample at all.

using JuliaBUGS, JSON, LogDensityProblems

const BE = JuliaBUGS.BUGSExamples

const CHAINS = 2
const WARMUP = 1000
const UPDATES = 10_000
const KEEP = 1000
# Long enough for the thousand-parameter models under ForwardDiff, short enough that a
# volume of them still fits in one six-hour job, which only publishes at its end.
const TIMEOUT_MINUTES = 60

length(ARGS) >= 1 ||
    error("usage: emit.jl <out-dir> [volume_1|volume_2|volume_3|all|<key>[,<key>...]]")
const OUT = abspath(ARGS[1])

# The second argument selects a whole volume or a comma-separated list of examples.
# Fitting everything takes hours, so a volume at a time is the usual way to run this,
# and a list is how a few examples get refitted without the rest.
const SELECT = length(ARGS) >= 2 && !isempty(ARGS[2]) ? ARGS[2] : "all"
const VOLUMES = (:volume_1, :volume_2, :volume_3)
const WANT_VOL = if SELECT == "all"
    VOLUMES
elseif Symbol(SELECT) in VOLUMES
    (Symbol(SELECT),)
else
    VOLUMES
end
const WANT_KEYS = SELECT == "all" || Symbol(SELECT) in VOLUMES ? nothing :
    Set(Symbol(strip(k)) for k in split(SELECT, ','))

"""
The driver rebuilds matrices with `stack(elems; dims = 1)`, so every inner JSON array
has to be a row. Julia's `JSON.print` writes a matrix column-wise, which arrives
transposed and then fails on the first out-of-range index, so rows are split here.
"""
jsonable(v::AbstractMatrix) = [jsonable(v[i, :]) for i in 1:size(v, 1)]
jsonable(v::AbstractArray{T,3}) where {T} = [jsonable(v[i, :, :]) for i in 1:size(v, 1)]
jsonable(v::AbstractVector) = [jsonable(x) for x in v]
jsonable(::Missing) = nothing
jsonable(v) = v

base_name(name) = first(split(name, '['; limit=2))

"""
    plan(ex)

Compile the example and decide its run settings. Returns `nothing` for a model with
nothing to sample.

The published initial values are kept only where they name a parameter, since the
driver rejects a name it does not know and several examples initialise data-like
nodes too, and only where they are complete, since the spec is stored as TOML, which
has no missing value. A model with discrete parameters is sampled with NUTS on the
marginalized log density; one that is discrete throughout has nothing left for a
gradient sampler and gets Metropolis-Hastings, which moves the discrete values itself.

The sampler keeps the driver's default AD backend. Mooncake was tried and fitted Rats
in 48 minutes where ForwardDiff takes 7, so the big models get a long timeout instead.
"""
function plan(ex)
    model = nothing
    if !isempty(ex.inits)
        model = try
            JuliaBUGS.compile(ex.model_def, ex.data, ex.inits)
        catch
            nothing
        end
    end
    model === nothing && (model = JuliaBUGS.compile(ex.model_def, ex.data))

    parameters = Set(
        String(JuliaBUGS.AbstractPPL.getsym(vn)) for
        vn in Base.invokelatest(JuliaBUGS.model_parameters, model)
    )
    isempty(parameters) && return nothing

    marginalized = Base.invokelatest(
        JuliaBUGS.set_evaluation_mode,
        JuliaBUGS.settrans(model, true),
        JuliaBUGS.UseAutoMarginalization(),
    )
    cache = marginalized.marginalization_cache
    discrete = cache === nothing ? 0 : cache.n_discrete_finite
    continuous = Base.invokelatest(LogDensityProblems.dimension, marginalized)

    complete(v) = v isa AbstractArray ? !any(ismissing, v) : !ismissing(v)
    inits = Dict(
        String(k) => jsonable(v) for
        (k, v) in pairs(ex.inits) if String(k) in parameters && complete(v)
    )
    return (; parameters, inits, discrete, continuous)
end

"""
    monitored(ex, parameters)

The deterministic quantities worth keeping in the bundle: those the original example
published summaries for. Everything else the model computes at each draw is dropped,
which is what keeps a bundle small for the models whose deterministic arrays dwarf
their parameters.
"""
function monitored(ex, parameters)
    published = ex.reference_results
    (isnothing(published) || isempty(published)) && return String[]
    names = unique(base_name(String(k)) for k in keys(published))
    return [n for n in names if !(n in parameters)]
end

"""
    plotted_variables(ex, parameters)

Which variables the published plots should show. A trace panel per parameter is
unreadable once a model has dozens, and Rats alone has 65, so this picks the ones
a reader came for: the parameters the original example published summaries for,
or failing that the scalar parameters, which are the population-level quantities in
these models rather than the per-unit ones.
"""
function plotted_variables(ex, parameters; limit=6)
    published = ex.reference_results
    if !isnothing(published) && !isempty(published)
        return first(String.(collect(keys(published))), limit)
    end
    scalars = sort([String(k) for (k, v) in pairs(ex.inits) if v isa Number && String(k) in parameters])
    return first(scalars, limit)
end

"""
    write_example(dir, vol, key, ex, p)

Write `<key>.jl`, `<key>.data.json`, and the run spec `<key>.json`. The model file
carries the original BUGS program verbatim and parses it with the string form of
`@bugs`, so what gets fitted is the program a reader recognises rather than a
deparsed Julia AST.
"""
function write_example(dir, vol, key, ex, p)
    open(joinpath(dir, "$(key).jl"), "w") do io
        println(io, "# ", ex.name)
        println(
            io, "# Generated from JuliaBUGS.BUGSExamples.", uppercase(string(vol)), ".", key
        )
        println(io, "using JuliaBUGS")
        println(io)
        println(io, "model_def = JuliaBUGS.@bugs(\"\"\"")
        print(io, ex.original_syntax_program)
        # `false` keeps the dotted BUGS names, so a published parameter reads
        # `beta.c` exactly as the original program and its reference table do.
        println(io, "\"\"\", false)")
        println(io)
        # Taking the starting values lets the driver compile from them rather than
        # from prior draws, which underflow for several of these models.
        println(
            io,
            "build_model(data, inits = (;)) = JuliaBUGS.compile(model_def, data, inits)",
        )
    end

    open(joinpath(dir, "$(key).data.json"), "w") do io
        JSON.print(io, Dict(string(k) => jsonable(v) for (k, v) in pairs(ex.data)))
    end

    sampler = Dict{String,Any}(
        "chains" => CHAINS, "warmup" => WARMUP, "draws" => KEEP, "thin" => UPDATES ÷ KEEP
    )
    isempty(p.inits) || (sampler["initial_params"] = p.inits)
    model = Dict{String,Any}(
        "kind" => "file", "path" => "$(key).jl", "monitor" => monitored(ex, p.parameters)
    )
    if p.continuous == 0
        sampler["algorithm"] = "MH"
    elseif p.discrete > 0
        model["evaluation_mode"] = "marginalized"
    end
    spec = Dict(
        "schema_version" => "0",
        "seed" => 42,
        "backend" => Dict("id" => "juliabugs"),
        "model" => model,
        "data_file" => "$(key).data.json",
        "sampler" => sampler,
    )
    open(joinpath(dir, "$(key).json"), "w") do io
        JSON.print(io, spec, 2)
    end
end

function main()
    mkpath(OUT)
    written = Pair{Symbol,Vector{String}}[]

    for (vol, examples) in pairs(BE.volumes()), (key, ex) in pairs(examples)
        vol in WANT_VOL || continue
        WANT_KEYS === nothing || key in WANT_KEYS || continue
        p = plan(ex)
        if p === nothing
            println("skipping $key: nothing to sample")
            continue
        end
        write_example(OUT, vol, key, ex, p)
        push!(written, key => plotted_variables(ex, p.parameters))
        how = p.continuous == 0 ? "MH on $(p.discrete) discrete" :
            p.discrete > 0 ? "NUTS on $(p.continuous) continuous, $(p.discrete) discrete marginalized" :
            "NUTS on $(p.continuous)"
        println("wrote $key: $how")
    end

    isempty(written) && error("nothing matched $(SELECT)")

    open(joinpath(OUT, "run.sh"), "w") do io
        println(io, "#!/bin/sh")
        println(
            io, "# Fits every emitted example and exports one bundle each. Slow: hours for"
        )
        println(io, "# the full set. Re-running skips a fit whose inputs have not changed.")
        println(io, "#")
        println(io, "# A model that fails is reported and skipped rather than stopping the")
        println(io, "# sweep, because losing an hour of finished fits to one bad model is")
        println(io, "# worse than an incomplete set. The exit status counts the failures.")
        println(io, "#")
        println(io, "# mcmc run exits 2 when it sampled but did not converge. Such a run is")
        println(io, "# still exported: its bundle carries the verdict, and seeing the chains")
        println(io, "# is how the model gets fixed.")
        println(io, "cd \"\$(dirname \"\$0\")\"")
        println(io, "failed=0")
        println(io)
        for (key, vars) in written
            shown = isempty(vars) ? "" : " --var " * join(("'$v'" for v in vars), " ")
            println(io, "echo \"== $key\"")
            println(io, "mcmc run $key.json --timeout $TIMEOUT_MINUTES")
            println(io, "status=\$?")
            println(io, "if [ \"\$status\" -eq 0 ] || [ \"\$status\" -eq 2 ]; then")
            println(io, "  mcmc export bundle -o bundles/$key.json --force \\")
            println(
                io,
                "    && mcmc plot --kind trace$shown --format svg",
                " -o bundles/$key-trace.svg \\",
            )
            println(
                io,
                "    && mcmc plot --kind density$shown --format svg",
                " -o bundles/$key-density.svg \\",
            )
            println(io, "    || { echo \"   $key FAILED\"; failed=\$((failed + 1)); }")
            println(io, "else")
            println(io, "  echo \"   $key FAILED\"; failed=\$((failed + 1))")
            println(io, "fi")
            println(io)
        end
        println(io, "echo \"\$failed example(s) failed\"")
        println(io, "exit \$failed")
    end
    mkpath(joinpath(OUT, "bundles"))

    println("wrote ", length(written), " example(s) to ", OUT)
    println("  fit them with: sh ", joinpath(OUT, "run.sh"))
end

main()
