# mcmcjs

## 0.4.0

### Minor Changes

- 864fc0d: Add `mcmc convert <graph.json>`: turn a DoodleBUGS graph into an idiomatic JuliaBUGS model file and a fit-able spec (backend `juliabugs` with the extracted `[data]`), so a graph can go straight to `mcmc fit`.
- 3ef8723: `mcmc diagnose` now reports divergent draws and fails the verdict when they exceed `--max-divergences` (default 0).
- 8173a7f: Add `mcmc fit --versions a,b,c` to run the same spec across multiple Julia versions, with `--keep-going`.
- 25eba55: Add the `mcmc fit` command, which runs Turing inference from a spec file and writes a samples file plus a reproducibility record.
- 7af7cfd: Add the `mcmc julia version` command group and `mcmc engines`, and route `mcmc doctor` through the engine registry.
- 5c3b6aa: Add the `mcmc predict` command, drawing posterior-predictive samples from a fitted model and its samples file.

### Patch Changes

- 088da28: Show the Julia environment-preparation notice across all fit and predict paths (including env healing and the version matrix), and fail fast when predicting with a non-Turing backend.
- Updated dependencies [84910a9]
- Updated dependencies [4205801]
- Updated dependencies [ebc1a69]
- Updated dependencies [d81dd1a]
- Updated dependencies [15681e8]
- Updated dependencies [9f8c973]
- Updated dependencies [25eb23b]
- Updated dependencies [9fc2bf3]
- Updated dependencies [514a2e5]
- Updated dependencies [3008951]
- Updated dependencies [a1324b3]
- Updated dependencies [31e9b46]
- Updated dependencies [2c53eb2]
- Updated dependencies [ea72662]
- Updated dependencies [956c62a]
- Updated dependencies [431d520]
- Updated dependencies [83e99b4]
- Updated dependencies [2fc817d]
- Updated dependencies [b69b192]
  - @mcmcjs/core@0.2.0
  - @mcmcjs/diagnostics@0.2.0
  - @mcmcjs/doodlebugs@0.1.0
  - @mcmcjs/engine@0.1.0
  - @mcmcjs/julia@0.3.0

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
