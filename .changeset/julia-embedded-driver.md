---
"@mcmcjs/julia": patch
---

The Julia driver and the pinned environment are embedded in the bundle and written to a content-keyed cache directory on first use, instead of shipping as loose files beside it, so a single-file CLI binary can run a fit too.
