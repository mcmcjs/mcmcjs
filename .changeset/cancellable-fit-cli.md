---
"mcmcjs": minor
---

Ctrl+C during sampling now cancels the fit gracefully: `mcmc run` and `mcmc fit` stop the Julia process promptly, record the run as `cancelled` (shown in `mcmc runs`/`mcmc show`), and exit 130, instead of leaving a runtime process behind. `--draws-out` is noted as skipped when a run is reused.
