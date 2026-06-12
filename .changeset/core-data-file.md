---
"@mcmcjs/core": minor
---

Add a top-level spec `data_file` (mutually exclusive with inline `[data]`), resolved to `dataFilePath` by parseSpec, and a `data_file` field on the run record, so data can be referenced by path instead of inlined.
