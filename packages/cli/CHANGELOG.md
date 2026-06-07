# mcmcjs

## 0.3.0

### Minor Changes

- 3025e8f: Add the `mcmc setup` command, which installs the Julia toolchain (juliaup and Julia) needed for inference.

### Patch Changes

- Updated dependencies [f94d19a]
  - @mcmcjs/julia@0.2.0

## 0.2.0

### Minor Changes

- 4cf6c51: Add the `mcmc doctor` command, which reports the installed Julia toolchain (juliaup and Julia).

### Patch Changes

- Updated dependencies [4cf6c51]
  - @mcmcjs/julia@0.1.0

## 0.1.0

### Minor Changes

- 6a95dfb: Initial release: the `mcmc` command-line tool with `mcmc diagnose`, a convergence report (R-hat, ESS, MCSE, HDI) from a samples file, with a human-readable table and `--json`, `--rhat-max`/`--ess-min`/`--hdi-prob` options, and a 0/1/2 exit-code contract.

### Patch Changes

- Updated dependencies [6a95dfb]
- Updated dependencies [6a95dfb]
  - @mcmcjs/core@0.1.0
  - @mcmcjs/diagnostics@0.1.0
