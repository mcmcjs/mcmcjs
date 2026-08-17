# JuliaBUGS reference for the Stan marginalization parity suite.
# Usage: julia --project=$JULIABUGS_PROJECT juliabugs_ref.jl spec.json out.json
# The spec carries {"model": "mixture"|"mixeddag", "data": {...}, "points": [{...}]}
# and the output carries per-point auto-marginalized logdensity plus the gradient
# in transformed space, keyed by parameter name.
using JuliaBUGS
using JuliaBUGS: @bugs, compile, settrans, set_evaluation_mode, UseAutoMarginalization
using JuliaBUGS.Model: BUGSModelWithGradient
using ADTypes: AutoForwardDiff
using ForwardDiff
using LogDensityProblems
using JSON

spec = JSON.parsefile(ARGS[1])
data = spec["data"]
fvec(x) = Float64.(collect(x))

if spec["model"] == "mixture"
    model_def = @bugs begin
        for i in 1:N
            z[i] ~ dcat(w[1:2])
            y[i] ~ dnorm(mu[z[i]], 1 / (sigma[z[i]] * sigma[z[i]]))
        end
        for k in 1:2
            sigma[k] ~ dexp(1)
            mu[k] ~ dnorm(0, 0.01)
        end
    end
    model_data = (N=Int(data["N"]), y=fvec(data["y"]), w=fvec(data["w"]))
elseif spec["model"] == "mixeddag"
    model_def = @bugs begin
        X ~ dcat(piX[1:2])
        Z ~ dcat(piZ[1:2])
        A ~ dnorm(muX[X], tauA)
        B ~ dnorm(A, tauB)
        pC = logistic(alpha0 + alpha1 * A)
        C ~ dbern(pC)
        D ~ dnorm(B + deltaC[C + 1] + deltaZ[Z], tauD)
    end
    model_data = (
        piX=fvec(data["piX"]), piZ=fvec(data["piZ"]), muX=fvec(data["muX"]),
        tauA=Float64(data["tauA"]), tauB=Float64(data["tauB"]),
        alpha0=Float64(data["alpha0"]), alpha1=Float64(data["alpha1"]),
        deltaC=fvec(data["deltaC"]), deltaZ=fvec(data["deltaZ"]),
        tauD=Float64(data["tauD"]), D=Float64(data["D"]),
    )
elseif spec["model"] == "binmix"
    model_def = @bugs begin
        phi ~ dbeta(2, 2)
        for i in 1:N
            z[i] ~ dbin(phi, 3)
            y[i] ~ dnorm(mu0 + delta * z[i], 1)
        end
    end
    model_data = (
        N=Int(data["N"]), y=fvec(data["y"]),
        mu0=Float64(data["mu0"]), delta=Float64(data["delta"]),
    )
elseif spec["model"] == "chaindag"
    model_def = @bugs begin
        X ~ dcat(piX[1:2])
        Y ~ dcat(theta[X, 1:2])
        sigma ~ dexp(1)
        yobs ~ dnorm(mu[Y], 1 / (sigma * sigma))
    end
    theta = permutedims(reduce(hcat, [fvec(r) for r in data["theta"]]))
    model_data = (
        piX=fvec(data["piX"]), theta=theta, mu=fvec(data["mu"]),
        yobs=Float64(data["yobs"]),
    )
else
    error("unknown model $(spec["model"])")
end

model = compile(model_def, model_data)
model = settrans(model, true)
model = set_evaluation_mode(model, UseAutoMarginalization())
param_order = model.marginalization_cache.continuous_model_parameters
ad_model = Base.invokelatest(BUGSModelWithGradient, model, AutoForwardDiff())

# The flat vector holds transformed values; the spec names each parameter's
# transform ("log" for lower-bounded, "logit" for unit-interval, identity otherwise).
transforms = get(spec, "transforms", Dict{String,Any}())
function theta_for(point)
    map(param_order) do vn
        s = string(vn)
        m = match(r"^([A-Za-z_][A-Za-z0-9_]*)(?:\[(\d+)\])?$", s)
        base = m[1]
        raw = Float64(m[2] === nothing ? point[base] : point[base][parse(Int, m[2])])
        t = get(transforms, base, "identity")
        t == "log" ? log(raw) : t == "logit" ? log(raw / (1 - raw)) : raw
    end
end

results = map(spec["points"]) do point
    theta = theta_for(point)
    ld, grad = Base.invokelatest(
        LogDensityProblems.logdensity_and_gradient, ad_model, theta
    )
    named = Dict(string(vn) => grad[i] for (i, vn) in enumerate(param_order))
    Dict("logdensity" => ld, "gradient" => named)
end

open(ARGS[2], "w") do io
    JSON.print(io, results)
end
