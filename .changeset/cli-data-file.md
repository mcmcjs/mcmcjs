---
"mcmcjs": minor
---

Treat --data (and a spec's data_file) as a reference: the data is loaded for the fit but recorded by path + file hash, and the frozen spec in the run store references the file instead of inlining a copy, so large datasets no longer bloat the store.
