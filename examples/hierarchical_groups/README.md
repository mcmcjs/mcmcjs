# Per-group means (`filldist`)

Estimate a separate mean for each group, with a shared `Exponential` prior and
an integer group-index vector selecting the right mean per observation. From the
Turing [core functionality](https://turinglang.org/docs/core-functionality/)
guide (the `filldist` example).

```bash
cd examples/hierarchical_groups
mcmc run hierarchical_groups.jl
```

The three entries of `a` recover near 1, 2, and 3.
