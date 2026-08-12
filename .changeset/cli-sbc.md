---
"mcmcjs": minor
---

Add mcmc sbc, the simulation-based calibration check: parameters drawn from the prior, datasets simulated through the model, each one refit, and the true parameters' posterior ranks tested for uniformity, with a rank histogram and a chi-square verdict per parameter. mcmc run gains --parallel for threaded chains.
