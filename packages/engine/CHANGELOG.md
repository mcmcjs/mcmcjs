# @mcmcjs/engine

## 0.4.0

### Minor Changes

- acacc1a: Ctrl+C now stops a running subprocess. Long-lived children (fit/predict sampling and streamed installs) are spawned in their own process group and force-killed on SIGINT/SIGTERM, so an interrupt takes down Julia (and any precompile workers) instead of leaving it running after the CLI exits. Adds `killTree` and `interruptGuard` helpers.

## 0.3.0

### Minor Changes

- e11251f: Add createStreamingRunner: a CommandRunner that streams a long subprocess's stdout/stderr live to this process's stderr (for install/precompile logs) instead of buffering them.

## 0.2.0

### Minor Changes

- 2a6e611: Stream runtime subprocesses instead of buffering them: the fit runner now spawns with line-wise stderr handling, routes mcmcjs progress lines to an onProgress callback, and keeps them out of the error buffer.

## 0.1.0

### Minor Changes

- a1324b3: Add `FitRunner` and `createFitRunner` (a capturing spawn with stderr and exit code) and the `FitResult` type.
- 31e9b46: Initial release: the runtime/PPL engine contract (`Engine`, `EngineCapabilities`, `HealthReport`) and a static engine registry.

### Patch Changes

- 2c53eb2: Widen `FitResult.stage` with the `load_samples` and `predict` stages.
