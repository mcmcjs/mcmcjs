---
"@mcmcjs/julia": minor
---

Condition Turing models on their data columns so a model that reads its outcome from the data table (`y = data["y"]; y[i] ~ dist`) observes it instead of sampling it, and fall back to `build_model` when the requested entry function is absent from the model file.
