using Turing

# Coin flip: estimate the probability of heads from a sequence of tosses.
# Adapted from the Turing "Coin Flipping" tutorial. The model file defines the
# model plus `build_model(data)`, which the driver calls with the spec's [data]
# table as a NamedTuple and expects a sampleable model back.
@model function coin_flip(y)
    p ~ Beta(1, 1)
    for i in eachindex(y)
        y[i] ~ Bernoulli(p)
    end
end

build_model(data) = coin_flip(Int.(data.y))
