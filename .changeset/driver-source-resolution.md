---
"@mcmcjs/julia": patch
---

Resolve the Julia driver and worker scripts from the in-repo source layout (`src/driver/`) when not running from the built bundle, so the package can be exercised directly from source (tests, tsx) without a build. The published `dist/` layout is unchanged.
