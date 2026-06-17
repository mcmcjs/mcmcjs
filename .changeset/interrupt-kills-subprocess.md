---
"@mcmcjs/engine": minor
---

Ctrl+C now stops a running subprocess. Long-lived children (fit/predict sampling and streamed installs) are spawned in their own process group and force-killed on SIGINT/SIGTERM, so an interrupt takes down Julia (and any precompile workers) instead of leaving it running after the CLI exits. Adds `killTree` and `interruptGuard` helpers.
