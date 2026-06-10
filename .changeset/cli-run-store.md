---
"mcmcjs": minor
---

Rework run around the hidden .mcmc run store: no more scaffolded model.toml or sibling samples files, settings flags always win over an optional spec, unchanged model+data+settings reuse the previous run (--refit to force), and new runs, show, and export commands plus diagnose defaulting to the latest run make the store the way to track models.
