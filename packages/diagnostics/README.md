# @mcmcjs/diagnostics

MCMC convergence diagnostics for [MCMC.js](https://github.com/mcmcjs/mcmcjs), following Vehtari et al. (2021).

It operates on plain arrays of chains (`Float64Array[]`), so it has no dependencies.

## What it provides

- **Convergence** — rank-normalized split-R-hat (`rhat`, with `basic`/`bulk`/`tail` variants), bulk/tail effective sample size (`essBulk`/`essTail`), Monte Carlo standard error (`mcseMean`/`mcseStd`/`mcseQuantile`), and the Geweke z-diagnostic (`geweke`).
- **Summaries** — mean, standard deviation, quantiles, highest-density interval (`hdi`), skewness, and excess kurtosis.
- **Other** — autocorrelation (`autocorr`), Pearson and Spearman correlation (`pearson`/`spearman`), and divergence counting.
- **Verdict** — `diagnoseChains` bundles the per-variable diagnostics and `isConverged` applies the default thresholds.

> Early alpha: the API is not yet stable.

## License

[MIT](./LICENSE) © [Shravan Goswami](https://shravangoswami.com)
