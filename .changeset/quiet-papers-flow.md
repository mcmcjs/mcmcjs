---
"@mcmcjs/engine": patch
"@mcmcjs/julia": patch
---

Draw streaming now waits for asynchronous consumers before reading more batches, keeping long fits bounded by the consumer's pace.
