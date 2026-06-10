---
"@mcmcjs/julia": minor
---

Serialize Turing fits natively from FlexiChains (Turing's default chain type) instead of converting through the MCMCChains bridge; the wire output is value-identical. MCMCChains remains only where it is still required: the JuliaBUGS backend and predict's chain reconstruction. The managed project now provisions FlexiChains and DimensionalData (existing environments heal automatically).
