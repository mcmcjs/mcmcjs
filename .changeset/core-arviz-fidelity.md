---
"@mcmcjs/core": minor
---

ArviZ parser now honors an arbitrary chain/draw dimension order (e.g. transposed `draw,chain`) and skips variables lacking those dims. Add a `fromChainArrays` helper that builds `Samples` from `{ chain: { variable: number[] } }`.
