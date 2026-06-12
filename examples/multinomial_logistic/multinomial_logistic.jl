using Turing
using LinearAlgebra
using Statistics

# Multinomial (softmax) logistic regression, from the Turing "Multinomial
# Logistic Regression" tutorial (iris: 3 species from 4 flower measurements).
# setosa is the pinned baseline class (logit 0); softmax is written out since
# the managed environment ships no LogExpFunctions.
function softmax3(v)
    e = exp.(v .- maximum(v))
    return e ./ sum(e)
end

@model function multinomial_logistic(x, y)
    nfeat, n = size(x)
    intercept_versicolor ~ Normal(0, 1)
    intercept_virginica ~ Normal(0, 1)
    coef_versicolor ~ MvNormal(zeros(nfeat), I)
    coef_virginica ~ MvNormal(zeros(nfeat), I)
    values_versicolor = intercept_versicolor .+ (coef_versicolor' * x)
    values_virginica = intercept_virginica .+ (coef_virginica' * x)
    for i in 1:n
        v = softmax3([0.0, values_versicolor[i], values_virginica[i]])
        y[i] ~ Categorical(v)
    end
end

function build_model(data)
    # The --data CSV gives one named vector per column; the model wants features
    # along dim 1 (a 4-by-N matrix), standardised per feature.
    x = stack([Float64.(data.sl), Float64.(data.sw), Float64.(data.pl), Float64.(data.pw)]; dims = 1)
    xs = (x .- mean(x; dims = 2)) ./ std(x; dims = 2)
    return multinomial_logistic(xs, Int.(data.y))
end
