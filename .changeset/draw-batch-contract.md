---
"@mcmcjs/engine": minor
---

Add a live draw-batch stream to the fit contract: a `DrawBatch` type (chain, monotonic per-chain seq, iteration, and parameter-leaf-name to values) and an `onDraws` callback on the fit runner, dispatched from the same line protocol as progress (`parseDrawBatchLine`). A runtime that emits draw batches as sampling proceeds is now surfaced to an embedding caller.
