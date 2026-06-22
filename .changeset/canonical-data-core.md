---
"@mcmcjs/core": minor
---

Add the canonical model-data model: a flat object keyed by variable name whose values are finite numbers or rectangular row-major nested numeric arrays (the same language-neutral JSON a Stan model reads). Exposes `validateCanonicalData`, `loadDataFile`, and `resolveData` with `CanonicalData` types; JSON loads verbatim and CSV normalizes to it (deriving `N` from the row count). Missing, non-numeric, and ragged values are rejected with a path-named error.
