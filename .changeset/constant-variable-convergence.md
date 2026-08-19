---
"mcmcjs": patch
"@mcmcjs/diagnostics": minor
---

Treat a variable that is constant across every draw as neutral for the convergence verdict rather than as a failure, since R-hat and ESS are undefined for it; a run whose every variable is constant still counts as not converged.
