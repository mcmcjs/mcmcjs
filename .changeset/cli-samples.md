---
"mcmcjs": minor
---

Add a `samples` command to export raw draws in a portable format: chain-major `{ chain_1: { variable: [...] } }` JSON (`--to json`, default) or MCMCChains JSON (`--to mcmcchains-json`), with `--stdin`, `--warmup`, `--store`, and `-o/--out`.
