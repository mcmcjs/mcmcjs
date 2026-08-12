---
"@mcmcjs/julia": minor
---

Chains can sample concurrently on Julia threads (sampler.parallel = "threads" adds --threads=auto and switches to MCMCThreads), and a Turing model file can declare its preferred AD backend via MCMC_DEFAULTS, which a spec or flag adtype overrides.
