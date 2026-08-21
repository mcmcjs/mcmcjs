# @mcmcjs/diagnostics

## 0.9.0

### Minor Changes

- d802b67: Degeneracy is now read from the draws rather than inferred from a missing R-hat: `VariableDiagnostics` carries `varies`, and `isDegenerate` uses it. R-hat is also undefined for a single chain, which previously made every one-chain variable look like a sampler that had stood still.

## 0.8.0

### Minor Changes

- c7139a3: Treat a variable that is constant across every draw as neutral for the convergence verdict rather than as a failure, since R-hat and ESS are undefined for it; a run whose every variable is constant still counts as not converged.
- 2ac2ead: Treat a variable as undiagnosable, and so neutral in the convergence verdict, whenever R-hat and ESS are undefined for want of variation rather than for unusable draws: a recovered discrete latent that sits on one value in one chain and moves once in another has a non-zero standard deviation but still no R-hat

## 0.7.0

### Minor Changes

- 60ee073: Add simulation-based calibration statistics: chiSquarePValue (chi-square survival function, scipy-validated) and sbcUniformity (binned rank uniformity test with proportional expectations).

## 0.6.0

### Minor Changes

- ce4801f: Add computeLooPit: leave-one-out probability integral transform values from the pointwise log-likelihood, predictive draws, and observed data, matching the arviz reference.

## 0.5.0

### Minor Changes

- c29759c: Add PSIS-LOO cross-validation, WAIC, and paired model comparison (gpdFit, psisSmooth, computeLoo, computeWaic, compareLoo, relativeEff), validated against the arviz reference implementation.

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
