---
"mcmcjs": minor
---

`mcmc --version` now prints GNU-style multi-line output: the version on the first line (`mcmc (mcmcjs) X.Y.Z`, still machine-parseable with `head -1`), followed by the one-line description, copyright with the build year, license, and homepage. The metadata is baked in at build time, so the published binary carries it with no runtime package.json. (The update-available note still appears separately on stderr for TTY sessions.)
