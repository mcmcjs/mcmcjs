---
"mcmcjs": minor
---

The browser now lists only files that really declare a model: a Julia file needs a `@model` or a `build_model`, a Stan file needs a `model` or `parameters` block, and `@model` inside a comment or docstring does not count, so a Julia library no longer shows every source file as a model. A model with no entry function is marked `needs a build_model` and can have the missing line added for it, and `mcmc run` prints the same suggestion when a fit fails for want of one.
