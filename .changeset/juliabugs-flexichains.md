---
"@mcmcjs/julia": minor
---

Upgrade the JuliaBUGS backend to JuliaBUGS 0.15: fits sample into FlexiChains (like the Turing backend) through the shared FlexiChains wire-writer, generated quantities are recovered via gen_chains, and the recommended AD backend is Mooncake, added to the managed project. The pinned Julia environment re-resolves to Turing 0.46, DynamicPPL 0.42, and AbstractPPL 0.15.
