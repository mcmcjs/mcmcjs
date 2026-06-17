---
"mcmcjs": minor
---

`mcmc run model.jl` now picks up a sibling data file automatically: with no `--data` and no spec, it uses `<model>.csv`, `data.csv`, or `data.json` from the model's directory (a note says which; `--data` still overrides). A missing `--data`/`data_file` path now fails with a clear "data file not found" message, and a fit that fails reading data fields with no data provided prints a hint pointing at `--data`. The sandbox's seeded model runs with a bare `mcmc run model.jl`.
