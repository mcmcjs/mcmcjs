---
"@mcmcjs/core": patch
---

Non-finite draws (serialized as JSON null in the MCMCChains format) now parse back as NaN instead of silently becoming 0, so diagnostics never run on fabricated zeros.
