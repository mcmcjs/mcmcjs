---
"mcmcjs": patch
---

Make `mcmc --help` self-explanatory: a footer now tells users to run `mcmc <command> --help` for a command's options, notes that `[options]` marks commands that take flags, and points out that `julia`, `daemon`, and `runs` group further subcommands. Mistyped or missing commands now suggest the closest match ("Did you mean fit?") and point at `mcmc --help`.
