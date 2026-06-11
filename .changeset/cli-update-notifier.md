---
"mcmcjs": minor
---

Notify about newer releases: a daily background check against the npm registry caches the latest version, and interactive commands end with a dim note when an update is available (stderr only, skipped without a TTY, in CI, and with MCMC_NO_UPDATE_CHECK=1).
