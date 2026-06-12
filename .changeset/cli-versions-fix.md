---
"mcmcjs": patch
---

Fix mcmc fit --versions across Julia versions: each version now provisions its own managed environment, so a Manifest resolved by one Julia no longer fails to precompile under another.
