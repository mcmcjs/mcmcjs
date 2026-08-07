---
"@mcmcjs/core": minor
---

The spec's sampler accepts algorithm = "Prior" for drawing from the prior instead of running MCMC; the stan backend rejects it at parse time.
