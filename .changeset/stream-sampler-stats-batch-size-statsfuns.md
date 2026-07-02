---
"@mcmcjs/julia": minor
---

Streamed draw batches now include the sampler statistics (acceptance rate, tree depth, step size, ...) under the same names the samples file records as internals, so consumers get per-draw diagnostics without a second channel. `FitIo` gains `drawBatchSize` to control how many draws each streamed batch carries. The managed Julia environment now includes StatsFuns, whose `logistic`/`logit` helpers are common in model files.
