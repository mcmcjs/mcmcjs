---
"@mcmcjs/core": minor
---

Add `[model].monitor`, a list of deterministic quantities to store with the parameters, so a JuliaBUGS model that computes large arrays at every draw can keep its run bundle small.
