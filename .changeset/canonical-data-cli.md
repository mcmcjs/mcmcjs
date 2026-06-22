---
"mcmcjs": patch
---

Model data (inline, `--data`, or a spec `data_file`) is now validated as canonical numeric data: non-numeric, missing, or ragged values are rejected with a clear error. Data loading moved into `@mcmcjs/core`.
