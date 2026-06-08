---
"@mcmcjs/julia": patch
---

The fit driver samples into Turing's default chain type (a FlexiChain) and converts via FlexiChains' MCMCChains conversion, instead of forcing chain_type.
