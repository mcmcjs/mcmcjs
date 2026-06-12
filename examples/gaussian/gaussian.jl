using Turing

# Estimate the unknown mean and variance of a Normal from i.i.d. observations.
# This is the classic `gdemo` from the Turing "Getting Started" guide.
@model function gaussian(y)
    s2 ~ InverseGamma(2, 3)
    m ~ Normal(0, sqrt(s2))
    for i in eachindex(y)
        y[i] ~ Normal(m, sqrt(s2))
    end
end

build_model(data) = gaussian(Float64.(data.y))
