---
"mcmcjs": minor
---

Add `mcmc run --stream-out <file>`, which streams sampled draws as NDJSON (one batch per line) as the run produces them. Pass `-` to stream to stdout (with the run report routed to stderr) for piping into another process.
