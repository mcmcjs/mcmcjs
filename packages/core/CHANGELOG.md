# @mcmcjs/core

## 0.4.0

### Minor Changes

- 9cdac38: Add a top-level spec `data_file` (mutually exclusive with inline `[data]`), resolved to `dataFilePath` by parseSpec, and a `data_file` field on the run record, so data can be referenced by path instead of inlined.

### Patch Changes

- c678c9f: Run keys can include managed-package version pins (RunKeyParts.packages); the key is unchanged when no pins are present, preserving cache hits for existing runs.

## 0.3.0

### Minor Changes

- 65484ab: Add the project-local run store: store discovery and layout under a hidden self-gitignored .mcmc directory, an append-only run ledger with cached convergence summaries, content-based run keys, and run refs (latest, @N, id prefix).

## 0.2.0

### Minor Changes

- 84910a9: Allow `backend.id = "juliabugs"` in the spec (alongside `"turing"`).
- 4205801: Add the optional `[predict]` spec block (`PredictSpec`) and posterior fields to the run record.
- ebc1a69: Add `serializeSpecToml` to emit a spec object as TOML (the inverse of `parseSpec`'s TOML read).
- d81dd1a: Add the inference spec format and parser (`parseSpec`, `SpecSchema`, `hashSpec`) and the `RunRecord` reproducibility type.

## 0.1.0

### Minor Changes

- 6a95dfb: Initial release: the `Samples` data model, parsers for MCMCChains JSON and ArviZ InferenceData JSON, format auto-detection via `parseSamples`, and a round-trip serializer.
