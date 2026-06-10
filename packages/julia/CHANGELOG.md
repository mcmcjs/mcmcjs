# @mcmcjs/julia

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
