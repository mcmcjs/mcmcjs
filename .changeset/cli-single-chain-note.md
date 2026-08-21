---
"mcmcjs": patch
---

`mcmc diagnose` no longer tells a healthy single-chain run that its sampler never moved. R-hat and ESS need two chains to compare, so a one-chain run now says exactly that and points at `--chains 2`, while a genuinely stuck sampler keeps its own note. The report also carries the chain count it diagnosed.
