---
"mcmcjs": minor
---

Add `mcmc run`, the zero-config front door: point it at a model file (`mcmc run model.jl --data data.csv`), an existing spec, or a DoodleBUGS graph, and it scaffolds a default spec when needed (backend detected from the model, data loaded from JSON or CSV, seed drawn once and saved), prints it, then fits and diagnoses in one command. `--init` stops after writing the spec for editing; an existing spec is reused on reruns.
