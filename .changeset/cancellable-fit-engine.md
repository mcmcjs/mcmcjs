---
"@mcmcjs/engine": minor
---

The fit contract is now cancellable: `FitRunner` accepts an `AbortSignal`, and on abort the child process (and its group) is killed and the result carries `cancelled: true`. `FitResult.status` gains a distinct `"cancelled"` outcome, separate from `"ok"` and `"error"`. When a signal is supplied the caller owns interruption, so the hard-exit guard is not installed.
