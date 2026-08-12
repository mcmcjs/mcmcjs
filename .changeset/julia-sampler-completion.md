---
"@mcmcjs/julia": minor
---

The driver runs the new samplers: Gibbs built from per-variable blocks (NUTS/HMC/HMCDA/MH/PG/ESS), SMC and PG, and externalsampler around the model file's MCMC_SAMPLER; parallel = "distributed" provisions worker processes with the model loaded and samples via MCMCDistributed.
