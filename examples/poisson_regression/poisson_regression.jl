using Turing
using Statistics

# Poisson regression (count outcome) with a log link, from the Turing "Bayesian
# Poisson Regression" tutorial (number of sneezes vs alcohol/medication). The
# count outcome `y` is observed data, not a latent parameter, so NUTS samples
# only the continuous coefficients.
@model function poisson_regression(alcohol, nomeds, product, y)
    b0 ~ Normal(0, 10)
    b_alcohol ~ Normal(0, 10)
    b_nomeds ~ Normal(0, 10)
    b_product ~ Normal(0, 10)
    for i in eachindex(y)
        theta = b0 + b_alcohol * alcohol[i] + b_nomeds * nomeds[i] + b_product * product[i]
        y[i] ~ Poisson(exp(theta))
    end
end

zscore(v) = (v .- mean(v)) ./ std(v)

function build_model(data)
    return poisson_regression(
        zscore(Float64.(data.alcohol)),
        zscore(Float64.(data.nomeds)),
        zscore(Float64.(data.product)),
        Int.(data.y),
    )
end
