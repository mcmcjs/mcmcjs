---
"mcmcjs": patch
"@mcmcjs/diagnostics": minor
---

Treat a variable as undiagnosable, and so neutral in the convergence verdict, whenever R-hat and ESS are undefined for want of variation rather than for unusable draws: a recovered discrete latent that sits on one value in one chain and moves once in another has a non-zero standard deviation but still no R-hat
