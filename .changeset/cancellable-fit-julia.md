---
"@mcmcjs/julia": minor
---

Sampling is cancellable through an `AbortSignal` threaded into `FitIo`. The one-shot driver kills the Julia process on abort; the persistent worker is killed by a pidfile it now writes beside its socket (a busy worker cannot answer a polite stop), so the next fit cold-starts a fresh one. Either way the run ends with a distinct `"cancelled"` status, and a cancelled run stops a version matrix.
