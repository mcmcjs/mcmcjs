---
"@mcmcjs/core": minor
---

The default Julia channel a fit runs on is now a pinned version (`DEFAULT_JULIA_CHANNEL`, exported) rather than the moving `release` channel, so a default run reproduces the exact package set the toolchain ships. Override per spec (`backend.version`) or with `--julia-version`.
