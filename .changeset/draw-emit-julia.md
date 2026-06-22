---
"@mcmcjs/julia": minor
---

The Julia driver now emits draw batches as sampling proceeds (one batch per chunk of iterations, per chain), when the request asks for it. A chain's batches reconstruct that chain's columns in the final samples file exactly, by canonical leaf name. Works for both the one-shot and persistent-worker paths.
