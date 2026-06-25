---
"@mcmcjs/core": minor
---

Add `dropWarmup(samples, n)` to discard the first n draws of every chain (rebuilding the chain-major layout) and `toChainArrays(samples)` to export model variables as a chain-major `{ chain_1: { variable: number[] } }` object (the inverse of `fromChainArrays`).
