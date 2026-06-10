# @mcmcjs/engine

## 0.1.0

### Minor Changes

- a1324b3: Add `FitRunner` and `createFitRunner` (a capturing spawn with stderr and exit code) and the `FitResult` type.
- 31e9b46: Initial release: the runtime/PPL engine contract (`Engine`, `EngineCapabilities`, `HealthReport`) and a static engine registry.

### Patch Changes

- 2c53eb2: Widen `FitResult.stage` with the `load_samples` and `predict` stages.
