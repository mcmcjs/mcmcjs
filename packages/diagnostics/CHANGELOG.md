# @mcmcjs/diagnostics

## 0.3.0

### Minor Changes

- b382de5: Export `autocorr(chain, maxLag?)`, the normalized autocorrelation of a chain (lag 0 = 1) computed from the same FFT used for ESS, so consumers get one canonical estimator.

## 0.2.0

### Minor Changes

- 15681e8: Add `countDivergences`, which counts divergent draws in a sampler-stat series.

## 0.1.0

### Minor Changes

- 6a95dfb: Initial release: MCMC convergence diagnostics (rank-normalized split-R-hat, bulk and tail ESS, MCSE, and HDI), plus `diagnoseChains` and `isConverged`.
