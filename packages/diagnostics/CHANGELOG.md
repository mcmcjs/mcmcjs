# @mcmcjs/diagnostics

## 0.4.0

### Minor Changes

- 25f73ff: Add `pearson` and `spearman` correlation: `pearson(xs, ys)` is the product-moment coefficient (0 when fewer than two pairs or the denominator vanishes) and `spearman(xs, ys)` applies it to 1-based ranks (no tie-averaging).
- af59faf: Add the Geweke (1992) convergence z-diagnostic: `geweke(chain, firstFrac?, lastFrac?)` compares the mean of the first `firstFrac` of a chain to the last `lastFrac`, standardized by a Bartlett-windowed spectral-density-at-0 standard error, returning `{ z, pValue }`.
- 0af8047: Add classic (non-rank) `splitRhat(chains)` and expose the single-chain IMSE estimator as `essIMSE(chain)`.

### Patch Changes

- 41b85d6: Export `computeSkewness` and `computeExcessKurtosis` from the package index (the estimators already existed internally).

## 0.3.0

### Minor Changes

- b382de5: Export `autocorr(chain, maxLag?)`, the normalized autocorrelation of a chain (lag 0 = 1) computed from the same FFT used for ESS, so consumers get one canonical estimator.

## 0.2.0

### Minor Changes

- 15681e8: Add `countDivergences`, which counts divergent draws in a sampler-stat series.

## 0.1.0

### Minor Changes

- 6a95dfb: Initial release: MCMC convergence diagnostics (rank-normalized split-R-hat, bulk and tail ESS, MCSE, and HDI), plus `diagnoseChains` and `isConverged`.
