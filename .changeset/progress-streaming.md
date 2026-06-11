---
"@mcmcjs/engine": minor
---

Stream runtime subprocesses instead of buffering them: the fit runner now spawns with line-wise stderr handling, routes mcmcjs progress lines to an onProgress callback, and keeps them out of the error buffer.
