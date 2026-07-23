# @mcmcjs/core

## 0.8.0

### Minor Changes

- 3376401: RunBundle: a self-contained single-file run format (ledger entry, resolved spec, model source, samples) with parseRunBundle validation, shared by the CLI exporter and the report web app.

## 0.7.0

### Minor Changes

- cd96f4d: Specs accept `backend.id = "stan"`: the runtime and default version channel are now derived per backend (julia channels for Turing/JuliaBUGS, the local CmdStan install for Stan), with validation that backends run on their own runtime and that package pins stay julia-only.
- 84cfd6b: Add `toStanName`, the inverse of `fromStanName`, mapping scalarized names like `theta[1,2]` back to Stan CSV notation.

### Patch Changes

- 824bf3c: Non-finite draws (serialized as JSON null in the MCMCChains format) now parse back as NaN instead of silently becoming 0, so diagnostics never run on fabricated zeros.

## 0.6.0

### Minor Changes

- e2a349c: ArviZ parser now honors an arbitrary chain/draw dimension order (e.g. transposed `draw,chain`) and skips variables lacking those dims. Add a `fromChainArrays` helper that builds `Samples` from `{ chain: { variable: number[] } }`.
- e2a349c: Add Stan (CmdStan) CSV ingestion: `fromStanCSV` and `fromStanCSVFiles` parse single or per-chain files, scalarize `a.1.2` to `a[1,2]`, and route the sampler diagnostics into `sampleStats` under canonical keys (energy, diverging, lp, ...).
- e2a349c: Add Turing.jl CSV ingestion: `parseTuringCsv` (and `parseSamples` auto-detect) reads the wide `iteration,chain`, wide `chain_,draw_`, and headerless long `chain,variable,iteration,value` layouts. Non-numeric cells become NaN in place so the result stays rectangular.
- d76de33: Add `dropWarmup(samples, n)` to discard the first n draws of every chain (rebuilding the chain-major layout) and `toChainArrays(samples)` to export model variables as a chain-major `{ chain_1: { variable: number[] } }` object (the inverse of `fromChainArrays`).

## 0.5.0

### Minor Changes

- b3b932b: Add the canonical model-data model: a flat object keyed by variable name whose values are finite numbers or rectangular row-major nested numeric arrays (the same language-neutral JSON a Stan model reads). Exposes `validateCanonicalData`, `loadDataFile`, and `resolveData` with `CanonicalData` types; JSON loads verbatim and CSV normalizes to it (deriving `N` from the row count). Missing, non-numeric, and ragged values are rejected with a path-named error.
- f7648a9: The default Julia channel a fit runs on is now a pinned version (`DEFAULT_JULIA_CHANNEL`, exported) rather than the moving `release` channel, so a default run reproduces the exact package set the toolchain ships. Override per spec (`backend.version`) or with `--julia-version`.

### Patch Changes

- a647be4: A run ledger entry can now record a `"cancelled"` status alongside `"ok"` and `"failed"`, for a fit that was stopped before finishing.

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
