---
"@mcmcjs/plots": patch
---

Stop flagging a variable with no variation in the forest plot's R-hat column: a recovered discrete latent has no R-hat to fail, so it now reads `n/a` rather than wearing a warning
