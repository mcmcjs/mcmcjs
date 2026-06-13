# mcmcjs

## 0.7.0

### Minor Changes

- 9cdac38: Treat --data (and a spec's data_file) as a reference: the data is loaded for the fit but recorded by path + file hash, and the frozen spec in the run store references the file instead of inlining a copy, so large datasets no longer bloat the store.
- e11251f: Stream live logs during the long phases instead of a static line: mcmc setup now shows juliaup's install output, and the "Preparing the Julia environment" step streams Pkg resolve/precompile output (both on stderr, so --json stays clean). A "starting Julia and loading Turing" indicator fills the brief silent gap before per-chain sampling progress.
- c678c9f: Pin and compare package versions: `[backend.packages]` in a spec, `--package name=version` on run (repeatable, flags win), and `mcmc fit --package-versions Turing=0.44,0.45` to run a spec across versions of a managed package, each in its own environment.
- fd302ac: Add `mcmc sandbox --strict` (and `pnpm sandbox --strict`): a fully isolated sandbox that redirects the managed environment, Julia/juliaup depots, caches, and worker sockets inside the throwaway directory, so it starts with no Julia installed and `mcmc setup` provisions a fresh toolchain that vanishes on exit.

### Patch Changes

- 3e6ab56: Fix mcmc fit --versions across Julia versions: each version now provisions its own managed environment, so a Manifest resolved by one Julia no longer fails to precompile under another.
- b2fda34: Polish the live-logs work from review: the "starting" indicator is a plain newline-terminated line (no parked cursor, so it never garbles the daemon's worker notice on a shared terminal) and names the actual backend (Turing.jl or JuliaBUGS); and mcmc julia version add/remove/update/gc now stream juliaup's install output live like mcmc setup.
- cf7f6d2: Harden the package-pin and matrix features from review: reject version strings that could inject Julia code (only safe version-spec characters allowed), make mcmc fit --versions honor a spec's package pins and record file-data references per version, reject --versions with --package-versions together, fail fast on unmanaged/unsafe pins, isolate juliaup under HOME in --strict sandboxes, and stop leaking the resolved dataFilePath into exported specs.
- Updated dependencies [9cdac38]
- Updated dependencies [c678c9f]
- Updated dependencies [e11251f]
- Updated dependencies [9cdac38]
- Updated dependencies [c678c9f]
- Updated dependencies [3e6ab56]
- Updated dependencies [cf7f6d2]
  - @mcmcjs/core@0.4.0
  - @mcmcjs/engine@0.3.0
  - @mcmcjs/julia@0.6.0

## 0.6.0

### Minor Changes

- 2a6e611: Show live per-chain sampling progress during run and fit, add --daemon (persistent Julia worker, 10x faster warm refits) with a daemon status/stop command group, and add mcmc sandbox: a throwaway shell seeded with a working example that is deleted on exit unless you choose to keep it.
- 65484ab: Rework run around the hidden .mcmc run store: no more scaffolded model.toml or sibling samples files, settings flags always win over an optional spec, unchanged model+data+settings reuse the previous run (--refit to force), and new runs, show, and export commands plus diagnose defaulting to the latest run make the store the way to track models.
- bbbc3bd: Notify about newer releases: a daily background check against the npm registry caches the latest version, and interactive commands end with a dim note when an update is available (stderr only, skipped without a TTY, in CI, and with MCMC_NO_UPDATE_CHECK=1).

### Patch Changes

- Updated dependencies [65484ab]
- Updated dependencies [65484ab]
- Updated dependencies [2a6e611]
- Updated dependencies [2a6e611]
  - @mcmcjs/core@0.3.0
  - @mcmcjs/julia@0.5.0
  - @mcmcjs/engine@0.2.0

## 0.5.1

### Patch Changes

- Updated dependencies [eaf569f]
  - @mcmcjs/julia@0.4.0

## 0.5.0

### Minor Changes

- 2ac0dc3: Add `mcmc run`, the zero-config front door: point it at a model file (`mcmc run model.jl --data data.csv`), an existing spec, or a DoodleBUGS graph, and it scaffolds a default spec when needed (backend detected from the model, data loaded from JSON or CSV, seed drawn once and saved), prints it, then fits and diagnoses in one command. `--init` stops after writing the spec for editing; an existing spec is reused on reruns.

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
