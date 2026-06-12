---
"@mcmcjs/julia": patch
---

runFit/finalizeOkFit accept a data-file reference (FitIo.dataFile) and an override data hash (FitIo.dataSha256), recording the reference rather than a copy of the data.
