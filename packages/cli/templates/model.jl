using Turing

# Simple linear regression: y = alpha + beta * x + noise.
# The data was generated with alpha = 2, beta = 3, so the fit should recover those.
@model function linear_regression(N, x, y)
    alpha ~ Normal(0, 10)
    beta ~ Normal(0, 10)
    sigma ~ truncated(Cauchy(0, 2); lower = 0)
    for i in 1:N
        y[i] ~ Normal(alpha + beta * x[i], sigma)
    end
end

build_model(data) = linear_regression(data.N, data.x, data.y)
