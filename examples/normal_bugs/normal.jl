import JuliaBUGS

# A model file defines the model plus `build_model(data)`, which the driver calls
# with the spec's [data] table as a NamedTuple and expects a sampleable model back.
# For JuliaBUGS the @bugs block is a callable model definition; calling it with the
# data builds the model.
const model_def = JuliaBUGS.@bugs begin
    mu ~ dnorm(0, 0.0001)
    tau ~ dgamma(0.01, 0.01)
    for i in 1:N
        y[i] ~ dnorm(mu, tau)
    end
    sigma = 1 / sqrt(tau)
end

build_model(data) = model_def(data; adtype = JuliaBUGS.ADTypes.AutoMooncake(; config = nothing))
