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
