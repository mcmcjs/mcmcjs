---
"@mcmcjs/core": patch
"@mcmcjs/engine": patch
"@mcmcjs/stan": patch
"mcmcjs": patch
---

Refuse an unobserved data entry inside the stan engine, so `mcmc fit` and every other entry point says why instead of only `mcmc run`
