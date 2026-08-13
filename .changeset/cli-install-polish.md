---
"mcmcjs": patch
---

The install script now points out that a shell caches the path of the mcmc it ran before (so an older copy keeps running until `hash -r`), and finds leftover copies that a plain lookup skips. A matching uninstall script removes the binary, and optionally the cached driver and report server state, leaving your runs and Julia alone.
