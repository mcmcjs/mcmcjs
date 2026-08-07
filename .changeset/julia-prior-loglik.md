---
"@mcmcjs/julia": minor
---

The driver gains prior sampling (Turing Prior(), ancestral evaluation for JuliaBUGS) and a loglik mode that evaluates the pointwise log-likelihood at every posterior draw; non-finite draws now serialize as null instead of failing the JSON write.
