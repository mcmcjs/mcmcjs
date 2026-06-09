---
"@mcmcjs/julia": minor
---

Add the JuliaBUGS backend: the fit driver dispatches on `backend.id`, the managed project provisions JuliaBUGS/AdvancedHMC/ForwardDiff (healing existing envs), and the request now carries the backend.
