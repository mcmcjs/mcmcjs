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

## Stan version

```bash
mcmc run hierarchical_groups.stan
```

The number of groups `K` is derived as `max(g)` in `transformed data`, matching Turing's `length(unique(g))` for the contiguous 1-based group indices in `data.csv`.
The Julia model's `mu` is only a return value, not tracked in the chain, so the Stan version has no generated quantities block.
