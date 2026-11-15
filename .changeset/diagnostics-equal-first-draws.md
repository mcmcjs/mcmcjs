---
"@mcmcjs/diagnostics": patch
---

`computeRhat`, `computeEssBulk` and `computeEssTail` returned NaN for a well-mixed discrete variable whenever every split chain started on the same value.
