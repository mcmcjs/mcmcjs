# Coin flip (Beta-Bernoulli)

The "hello world" of Bayesian inference: estimate the heads probability `p` of a
coin from a sequence of tosses, with a uniform `Beta(1, 1)` prior. Adapted from
the Turing [Coin Flipping](https://turinglang.org/docs/tutorials/coin-flipping/)
tutorial.

```bash
cd examples/coin_flip
mcmc run coin_flip.jl
```

The data has 23 heads in 40 tosses, so `p` concentrates near 0.575.
