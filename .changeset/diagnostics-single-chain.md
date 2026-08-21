---
"@mcmcjs/diagnostics": minor
---

Degeneracy is now read from the draws rather than inferred from a missing R-hat: `VariableDiagnostics` carries `varies`, and `isDegenerate` uses it. R-hat is also undefined for a single chain, which previously made every one-chain variable look like a sampler that had stood still.
