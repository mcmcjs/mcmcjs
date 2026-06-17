---
"mcmcjs": patch
---

Ctrl+C during a fit or install now aborts cleanly: the Julia process group is killed and the CLI exits 130, rather than the run continuing in the background. The live install region is erased before exit so the terminal is left clean.
