---
"mcmcjs": patch
---

`mcmc update` no longer fails with EXDEV when the temp directory and the install directory are on different filesystems, which is the normal case for /tmp and ~/.local/bin. The new binary is staged beside the old one and renamed over it.
