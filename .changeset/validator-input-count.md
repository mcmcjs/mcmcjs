---
"@mcmcjs/doodleppl": patch
---

Count distribution inputs correctly when a parent is referenced nested inside a parameter expression (for example mu[z[i]]), which previously reported a spurious parameter-count mismatch.
