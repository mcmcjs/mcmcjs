---
"@mcmcjs/doodleppl": minor
---

Generate marginalized Stan code for discrete latent variables: dcat, dbern, and dbin latents (iid in a plate, or scalar DAGs) are summed out with log_sum_exp via frontier-based variable elimination instead of emitting a warning, observed discrete vectors with missing entries marginalize just the missing ones when data is passed to the generator, and recovered in generated quantities from their exact conditional posterior; unsupported structures (chains, infinite support, unresolvable support sizes) keep the warning comment with the reason.
