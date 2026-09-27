---
"mcmcjs": patch
---

Fits run on a Julia installed without juliaup, such as Colab's Julia runtime, when it is the pinned version, instead of failing with "juliaup not found" after `mcmc setup` reported the toolchain ready.
