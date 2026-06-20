---
"mcmcjs": minor
---

Restructure `mcmc --help` and make bare invocations friendly. The command list is now grouped under functional headings (Run inference, Inspect runs, Start a project, Toolchain) with terse summaries, and the help carries a quickstart line, an exit-code legend, and a docs link. Bare `mcmc` now prints that grouped help and exits 0 instead of erroring. Bare `mcmc julia` (and `mcmc julia version`) now shows the Julia version status and exits 0, consistent with `mcmc runs` and `mcmc daemon`.
