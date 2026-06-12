---
"@mcmcjs/core": patch
---

Run keys can include managed-package version pins (RunKeyParts.packages); the key is unchanged when no pins are present, preserving cache hits for existing runs.
