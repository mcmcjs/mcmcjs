---
"@mcmcjs/plots": patch
---

A forest row from a single-chain run is no longer flagged as converged. Only a variable that never moves is excused from having an R-hat; one chain leaves R-hat undefined for an unrelated reason, and marking it converged painted an untested run green.
