---
"mcmcjs": minor
---

Complete the model-checking workflow: mcmc run --prior draws from the prior, mcmc loo estimates out-of-sample fit with PSIS-LOO and WAIC (pointwise log-likelihood computed once and cached in the run directory, or read from Stan log_lik columns), mcmc compare ranks runs by elpd with paired-difference errors, and mcmc plot gains ppc-density and ppc-stat kinds with an --observed flag.
