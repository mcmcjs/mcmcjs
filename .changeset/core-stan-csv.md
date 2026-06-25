---
"@mcmcjs/core": minor
---

Add Stan (CmdStan) CSV ingestion: `fromStanCSV` and `fromStanCSVFiles` parse single or per-chain files, scalarize `a.1.2` to `a[1,2]`, and route the sampler diagnostics into `sampleStats` under canonical keys (energy, diverging, lp, ...).
