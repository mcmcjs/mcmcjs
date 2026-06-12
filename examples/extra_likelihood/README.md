# Adding a likelihood with `@addlogprob!`

Estimate a mean `mu` where the data's contribution to the log-density is added
explicitly with `@addlogprob!` rather than through a `~` statement. From the
Turing [Modifying the log-probability](https://turinglang.org/docs/usage/modifying-logprob/)
guide; useful when a likelihood term doesn't fit the tilde syntax.

```bash
cd examples/extra_likelihood
mcmc run extra_likelihood.jl --data data.csv
```

The five observations average to 0, so `mu` concentrates near 0.
