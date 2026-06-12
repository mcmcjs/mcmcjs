using Turing

# First-order autoregressive model, AR(1): each value depends linearly on the
# previous one plus noise. This is the canonical Bayesian time-series model and
# a relative of the Turing "Bayesian Time Series Analysis" tutorial; it samples
# cleanly, unlike a Fourier decomposition over a short series (where low
# frequencies are collinear with the trend).
@model function ar1(y)
    alpha ~ Normal(0, 5)        # intercept
    phi ~ Uniform(-1, 1)        # autoregressive coefficient (|phi| < 1 is stationary)
    sigma ~ truncated(Normal(0, 1); lower = 0)
    for t in 2:lastindex(y)
        y[t] ~ Normal(alpha + phi * y[t - 1], sigma)
    end
end

build_model(data) = ar1(Float64.(data.y))
