---
"mcmcjs": minor
---

Collapse the long install/precompile output instead of dumping it: by default a TTY shows a single spinner with the current phase (resolving/downloading/precompiling) and elapsed time, erased when done, while a non-TTY prints one line per phase; failures still print the captured output tail. `--verbose` (on run/fit/predict/setup and julia version add/remove/update/gc) restores the full raw stream, and `--json` stays silent.
