---
"@mcmcjs/julia": minor
---

Upgrade the JuliaBUGS backend to JuliaBUGS 0.15: fits sample into FlexiChains (like the Turing backend) through the shared FlexiChains wire-writer, and the recommended AD backend is Mooncake, added to the managed project. The example model builds via the callable `@bugs` definition with `AutoMooncake`.
