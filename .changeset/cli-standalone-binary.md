---
"mcmcjs": minor
---

Install without npm: `curl -fsSL https://mcmcjs.github.io/mcmcjs/install.sh | sh` fetches a single-file `mcmc` binary that carries its own runtime, the example templates, and the Julia driver, so it needs neither Node.js nor npm. The script verifies release checksums and reports an existing install rather than silently shadowing it, and `mcmc doctor` now names the copy that is running and warns when a second one is on PATH.
