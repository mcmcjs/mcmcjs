---
"@mcmcjs/doodleppl": patch
---

The Stan generator assigns a top-level deterministic node before a plate loop that reads it, in transformed data, transformed parameters and generated quantities, instead of after the loop, where every chain failed to initialize.
