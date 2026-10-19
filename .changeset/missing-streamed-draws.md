---
"@mcmcjs/engine": patch
---

Missing or non-finite streamed draws were read as zero instead of NaN.
