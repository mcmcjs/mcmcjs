---
"@mcmcjs/diagnostics": minor
---

Add the Geweke (1992) convergence z-diagnostic: `geweke(chain, firstFrac?, lastFrac?)` compares the mean of the first `firstFrac` of a chain to the last `lastFrac`, standardized by a Bartlett-windowed spectral-density-at-0 standard error, returning `{ z, pValue }`.
