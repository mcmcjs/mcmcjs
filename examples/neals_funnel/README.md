# Neal's funnel (tracked quantities)

A non-centered parameterisation of Neal's funnel, from the Turing
[Tracking extra quantities](https://turinglang.org/docs/usage/tracking-extra-quantities/)
guide. The funnel variables `x` and `y` are recorded as tracked quantities
(`:=`) derived from standard-normal raw draws. There is no data — it samples a
prior with notoriously hard geometry.

```bash
cd examples/neals_funnel
mcmc run neals_funnel.jl
```

This is an intentional stress test: even with the non-centered form, expect this
to be the hardest example to sample cleanly. It is a good way to see what the
diagnostics report when geometry is difficult.

## Stan version

```bash
cd examples/neals_funnel
mcmc run neals_funnel.stan
```

There is no data, so the Stan model has no `data` block: it declares `y_raw` and the `vector[9] x_raw` as standard-normal parameters and builds the funnel variables `y = 3 * y_raw` and `x = exp(y / 2) * x_raw` in a `generated quantities` block, mirroring the Turing tracked quantities (`:=`).
Parameter and quantity names match the Julia chain (`y_raw`, `x_raw`, `y`, `x`) so the two backends line up for side-by-side diagnostics.
Divergences and a high R-hat are expected here and are part of the lesson, not a bug in the translation.

