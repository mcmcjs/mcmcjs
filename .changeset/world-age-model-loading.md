---
"@mcmcjs/julia": patch
---

Loading a model no longer emits a Julia 1.12 world-age binding warning: the model file is loaded into its own module and its entry is resolved in the latest world. Each run's model is isolated, so repeated runs in the persistent worker cannot collide on global names.
