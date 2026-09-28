---
"mcmcjs": patch
---

`mcmc run` samples again when `model.evaluation_mode` or `model.monitor` changes, instead of returning a stored run that was evaluated another way or stored other quantities.
