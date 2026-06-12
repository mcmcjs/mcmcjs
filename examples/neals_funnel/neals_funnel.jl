using Turing

# Neal's funnel, from the Turing "Tracking extra quantities" guide. The model is
# parameterised by standard-normal "raw" variables and the funnel shape is built
# with tracked quantities (`:=`), which are recorded in the chain alongside the
# sampled parameters. There is no observed data; it samples a prior with famously
# difficult geometry, a good stress test for the sampler and diagnostics.
@model function neals_funnel()
    y_raw ~ Normal(0, 1)
    x_raw ~ filldist(Normal(0, 1), 9)
    y := 3 * y_raw
    x := exp.(y ./ 2) .* x_raw
end

build_model(data) = neals_funnel()
