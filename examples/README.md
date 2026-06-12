# Examples

A gallery of small, self-contained models adapted from the
[Turing documentation](https://turinglang.org/docs/), each in its own directory
so you can run one and watch a real fit go through the whole pipeline (fit ->
diagnose) with live per-chain progress.

Each directory holds a model file, its data, and a short README. The model file
defines the model idiomatically (`@model` for Turing, `@bugs` for JuliaBUGS) and
a one-line `build_model(data)` adapter: the driver loads the data, calls
`build_model(data)` with it as a `NamedTuple`, and samples the returned model.
Data is supplied with `--data` (a `.csv` of columns or a `.json` object), so no
configuration file is needed; settings come from defaults and flags.

```bash
cd examples/coin_flip
mcmc run coin_flip.jl --data data.csv                         # fit + convergence report
mcmc run coin_flip.jl --data data.csv --draws 4000 --daemon   # more draws, warm worker
```

`eight_schools` is the exception: it keeps a committed `.toml` spec to show the
spec workflow (pinned seed, inline data, and a `predict` section that flags
can't express). `neals_funnel` has no data and is run as `mcmc run neals_funnel.jl`.

## The models

| Example | Idea | Backend | Source tutorial |
| --- | --- | --- | --- |
| `coin_flip` | Beta-Bernoulli proportion | Turing | Coin Flipping |
| `gaussian` | mean + variance of a Normal | Turing | Getting Started |
| `linear_regression` | multiple regression (mtcars) | Turing | Bayesian Linear Regression |
| `logistic_regression` | binary outcome, logit link | Turing | Bayesian Logistic Regression |
| `poisson_regression` | counts, log link | Turing | Bayesian Poisson Regression |
| `multinomial_logistic` | 3-class softmax (iris) | Turing | Multinomial Logistic Regression |
| `hierarchical_groups` | per-group means (`filldist`) | Turing | Core Functionality |
| `gaussian_mixture` | 2-component mixture (marginalised) | Turing | Gaussian Mixture Models |
| `time_series` | trend + seasonal decomposition | Turing | Bayesian Time Series Analysis |
| `extra_likelihood` | `@addlogprob!` likelihood term | Turing | Modifying the log-probability |
| `neals_funnel` | tracked quantities, hard geometry | Turing | Tracking Extra Quantities |
| `eight_schools` | hierarchical partial pooling (spec showcase) | Turing | (classic) |
| `normal_bugs` | mean + precision on the JuliaBUGS backend | JuliaBUGS | (classic) |

Models run with NUTS, so every example is continuous (the mixture marginalises
out its discrete cluster labels). `gaussian_mixture` and especially
`neals_funnel` are intentionally harder to sample, which makes them good for
seeing what the diagnostics report when convergence is not clean.

## Trying the diagnostics directly

`example-samples.json` is a ready-made MCMCChains-format samples file (4 chains x
200 draws, variables `mu` and `sigma`) for trying `diagnose` without running a fit:

```bash
mcmc diagnose examples/example-samples.json          # human-readable table + verdict
mcmc diagnose examples/example-samples.json --json   # machine-readable report
```

Exit codes: `0` converged, `2` ran but not converged, `1` error.
