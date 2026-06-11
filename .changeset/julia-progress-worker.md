---
"@mcmcjs/julia": minor
---

Stream per-chain sampling progress from the driver as JSON lines, clean up fit request dirs under a shared tmp parent, and add the opt-in persistent worker (runFitAuto, a Unix-socket worker.jl reusing the driver fit logic, automatic fallback to the one-shot driver).
