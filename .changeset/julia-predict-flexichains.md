---
"@mcmcjs/julia": patch
---

Posterior prediction now runs through FlexiChains, Turing's default chain type, instead of the archived MCMCChains: the saved posterior is rebuilt into a VNChain and fed to predict, and MCMCChains is dropped from the Julia environment.
