---
"mcmcjs": minor
---

Add `mcmc update`, which updates this copy in place: a binary install replaces itself from the latest release after checking the download against the release checksums, and an npm install goes through npm. `--check` only reports, `--force` reinstalls the current version to repair one. `mcmc --version` now draws the wordmark for a person at a terminal, keeping the parseable version on line 1 for scripts.
