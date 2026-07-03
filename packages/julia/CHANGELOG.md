# @mcmcjs/julia

## 0.9.1

### Patch Changes

- Updated dependencies [824bf3c]
- Updated dependencies [cd96f4d]
- Updated dependencies [84cfd6b]
  - @mcmcjs/core@0.7.0

## 0.9.0

### Minor Changes

- dacb976: Streamed draw batches now include the sampler statistics (acceptance rate, tree depth, step size, ...) under the same names the samples file records as internals, so consumers get per-draw diagnostics without a second channel. `FitIo` gains `drawBatchSize` to control how many draws each streamed batch carries. The managed Julia environment now includes StatsFuns, whose `logistic`/`logit` helpers are common in model files.

## 0.8.0

### Minor Changes

- 8c57520: Condition Turing models on their data columns so a model that reads its outcome from the data table (`y = data["y"]; y[i] ~ dist`) observes it instead of sampling it, and fall back to `build_model` when the requested entry function is absent from the model file.

## 0.7.1

### Patch Changes

- Updated dependencies [e2a349c]
- Updated dependencies [e2a349c]
- Updated dependencies [e2a349c]
- Updated dependencies [d76de33]
  - @mcmcjs/core@0.6.0

## 0.7.0

### Minor Changes

- 99e5581: Sampling is cancellable through an `AbortSignal` threaded into `FitIo`. The one-shot driver kills the Julia process on abort; the persistent worker is killed by a pidfile it now writes beside its socket (a busy worker cannot answer a polite stop), so the next fit cold-starts a fresh one. Either way the run ends with a distinct `"cancelled"` status, and a cancelled run stops a version matrix.
- 5af3509: The Julia driver now emits draw batches as sampling proceeds (one batch per chunk of iterations, per chain), when the request asks for it. A chain's batches reconstruct that chain's columns in the final samples file exactly, by canonical leaf name. Works for both the one-shot and persistent-worker paths.
- 32a5ac5: Forward draw batches through the fit runners: `FitIo.onDraws` is threaded into the one-shot runner and the daemon worker reader (which now recognizes draw-batch lines alongside progress), so an embedding caller receives draws as the runtime emits them.
- 3d7186c: Bind model data so a Turing model can read a variable either as a property (`data.y`) or by index (`data["y"]` / `data[:y]`), with `haskey` and `keys` supported, so models written in either idiom run unchanged. JuliaBUGS continues to receive a plain NamedTuple.
- 6d66bd2: Ship a committed, resolved Julia environment (Project.toml + Manifest.toml) and instantiate it for a default provision, so every machine gets the exact same package versions instead of re-resolving the latest compatible ones. Existing managed environments re-provision onto the committed Manifest on their next run. A `--versions` matrix or any package pin still resolves fresh. `mcmc setup` now installs the pinned Julia version (via the installer's default channel, or `juliaup add`).

### Patch Changes

- 469da2e: Resolve the Julia driver and worker scripts from the in-repo source layout (`src/driver/`) when not running from the built bundle, so the package can be exercised directly from source (tests, tsx) without a build. The published `dist/` layout is unchanged.
- Updated dependencies [a647be4]
- Updated dependencies [80f5fab]
- Updated dependencies [b3b932b]
- Updated dependencies [b38a4e5]
- Updated dependencies [f7648a9]
  - @mcmcjs/core@0.5.0
  - @mcmcjs/engine@0.5.0

## 0.6.1

### Patch Changes

- Updated dependencies [acacc1a]
  - @mcmcjs/engine@0.4.0

## 0.6.0

### Minor Changes

- c678c9f: Support managed-package version pins: managedProjectDir/managedProjectReady/ensureProject take a PackagePins map, key the env by the pins, install pinned versions via Pkg.PackageSpec, and reject pins for unmanaged packages.
- 3e6ab56: Key the managed Julia environment by version (managedProjectDir(version)) so each Julia version resolves its own compatible Manifest; runMatrix now provisions per version via an injected ensure callback instead of sharing one env.

### Patch Changes

- 9cdac38: runFit/finalizeOkFit accept a data-file reference (FitIo.dataFile) and an override data hash (FitIo.dataSha256), recording the reference rather than a copy of the data.
- cf7f6d2: Harden the package-pin and matrix features from review: reject version strings that could inject Julia code (only safe version-spec characters allowed), make mcmc fit --versions honor a spec's package pins and record file-data references per version, reject --versions with --package-versions together, fail fast on unmanaged/unsafe pins, isolate juliaup under HOME in --strict sandboxes, and stop leaking the resolved dataFilePath into exported specs.
- Updated dependencies [9cdac38]
- Updated dependencies [c678c9f]
- Updated dependencies [e11251f]
  - @mcmcjs/core@0.4.0
  - @mcmcjs/engine@0.3.0

## 0.5.0

### Minor Changes

- 65484ab: Let fit callers choose the run record path (FitIo.recordPath) and report the channel's concrete Julia version from resolveVersion.
- 2a6e611: Stream per-chain sampling progress from the driver as JSON lines, clean up fit request dirs under a shared tmp parent, and add the opt-in persistent worker (runFitAuto, a Unix-socket worker.jl reusing the driver fit logic, automatic fallback to the one-shot driver).

### Patch Changes

- Updated dependencies [65484ab]
- Updated dependencies [2a6e611]
  - @mcmcjs/core@0.3.0
  - @mcmcjs/engine@0.2.0

## 0.4.0

### Minor Changes

- eaf569f: Serialize Turing fits natively from FlexiChains (Turing's default chain type) instead of converting through the MCMCChains bridge; the wire output is value-identical. MCMCChains remains only where it is still required: the JuliaBUGS backend and predict's chain reconstruction. The managed project now provisions FlexiChains and DimensionalData (existing environments heal automatically).

## 0.3.0

### Minor Changes

- ea72662: Add the Turing fit runner (`runFit`), the Julia driver, and managed-project provisioning (`ensureProject`); `juliaEngine` now reports the `fit` capability.
- 431d520: Add the JuliaBUGS backend: the fit driver dispatches on `backend.id`, the managed project provisions JuliaBUGS/AdvancedHMC/ForwardDiff (healing existing envs), and the request now carries the backend.
- 83e99b4: Add posterior prediction: a predict driver mode and `runPredict`; `juliaEngine` now reports the `predict` capability.
- 2fc817d: Add `runMatrix`, which runs the same spec across several Julia versions (one samples file per version, fail-soft).
- b69b192: Add Julia version management (list, add, remove, default, update, gc, resolve) over juliaup and the `juliaEngine` implementation.

### Patch Changes

- 956c62a: The fit driver samples into Turing's default chain type (a FlexiChain) and converts via FlexiChains' MCMCChains conversion, instead of forcing chain_type.
- Updated dependencies [84910a9]
- Updated dependencies [4205801]
- Updated dependencies [ebc1a69]
- Updated dependencies [d81dd1a]
- Updated dependencies [a1324b3]
- Updated dependencies [31e9b46]
- Updated dependencies [2c53eb2]
  - @mcmcjs/core@0.2.0
  - @mcmcjs/engine@0.1.0

## 0.2.0

### Minor Changes

- f94d19a: Add `runSetup`, `planSetup`, and `juliaupInstallCommand` to install the Julia toolchain (juliaup and Julia).

## 0.1.0

### Minor Changes

- 4cf6c51: Initial release: Julia toolchain detection (juliaup and Julia) via `detectJulia`, `detectJuliaup`, and `runDoctor`.
