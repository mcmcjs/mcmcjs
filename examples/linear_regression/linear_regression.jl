using Turing
using LinearAlgebra
using Statistics

# Multiple linear regression with a coefficient vector, from the Turing
# "Bayesian Linear Regression" tutorial (mtcars: predict MPG). Predictors and
# target are standardised in the adapter, exactly as the tutorial does, so the
# weakly-informative priors live on a sensible scale.
@model function linear_regression(x, y)
    sigma2 ~ truncated(Normal(0, 100); lower = 0)
    intercept ~ Normal(0, sqrt(3))
    nfeatures = size(x, 2)
    coefficients ~ MvNormal(zeros(nfeatures), 10.0 * I)
    mu = intercept .+ x * coefficients
    return y ~ MvNormal(mu, sigma2 * I)
end

standardize(m::AbstractMatrix) = (m .- mean(m; dims = 1)) ./ std(m; dims = 1)
standardize(v::AbstractVector) = (v .- mean(v)) ./ std(v)

function build_model(data)
    # The --data CSV gives one named vector per column; stack predictors into
    # an observations-by-features design matrix.
    x = stack([Float64.(data.cyl), Float64.(data.hp), Float64.(data.wt)]; dims = 2)
    return linear_regression(standardize(x), standardize(Float64.(data.mpg)))
end
