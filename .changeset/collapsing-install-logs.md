---
"mcmcjs": minor
---

Show the long install/precompile output live but clean up after it: by default a TTY keeps a small fixed region (a spinner with the current phase and elapsed time, above the last few real output lines) that is erased once the step finishes, so the firehose is visible while it runs and gone when it is done; a non-TTY prints one line per phase. Failures still print the captured output tail so the real error stays visible. `--verbose` (on run/fit/predict/setup and julia version add/remove/update/gc) keeps the full raw stream on screen, and `--json` stays silent.
