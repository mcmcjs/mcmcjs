using Turing
using Statistics

# Logistic regression with named coefficients, from the Turing "Bayesian
# Logistic Regression" tutorial (predicting loan default). The likelihood uses
# `BernoulliLogit`, which takes the log-odds directly: this is numerically
# stable and avoids the domain error you hit if `logistic(z)` rounds a Dual just
# past 1 under automatic differentiation. Continuous predictors are standardised
# in the adapter; the binary `student` flag is not.
@model function logistic_regression(student, balance, income, y)
    intercept ~ Normal(0, 1)
    b_student ~ Normal(0, 1)
    b_balance ~ Normal(0, 1)
    b_income ~ Normal(0, 1)
    for i in eachindex(y)
        z = intercept + b_student * student[i] + b_balance * balance[i] + b_income * income[i]
        y[i] ~ BernoulliLogit(z)
    end
end

zscore(v) = (v .- mean(v)) ./ std(v)

function build_model(data)
    return logistic_regression(
        Float64.(data.student),
        zscore(Float64.(data.balance)),
        zscore(Float64.(data.income)),
        Int.(data.y),
    )
end
