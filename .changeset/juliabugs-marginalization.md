---
"mcmcjs": minor
---

mcmc convert now emits a JuliaBUGS model that enables auto-marginalization when the graph has discrete latents, so such a model fits with NUTS instead of failing on an integer gradient, and the latents come back in the chain.
