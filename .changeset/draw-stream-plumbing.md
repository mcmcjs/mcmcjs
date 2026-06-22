---
"@mcmcjs/julia": minor
---

Forward draw batches through the fit runners: `FitIo.onDraws` is threaded into the one-shot runner and the daemon worker reader (which now recognizes draw-batch lines alongside progress), so an embedding caller receives draws as the runtime emits them.
