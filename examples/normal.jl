import JuliaBUGS

# The model file a spec references defines build_model(data); for the JuliaBUGS
# backend it returns a compiled, AD-enabled BUGS model.
function build_model(data)
    model_def = JuliaBUGS.@bugs begin
        mu ~ dnorm(0, 0.0001)
        tau ~ dgamma(0.01, 0.01)
        for i in 1:N
            y[i] ~ dnorm(mu, tau)
        end
        sigma = 1 / sqrt(tau)
    end
    return JuliaBUGS.compile(model_def, data; adtype = JuliaBUGS.ADTypes.AutoForwardDiff())
end
