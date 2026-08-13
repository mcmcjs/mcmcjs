---
"mcmcjs": minor
---

The MCP server moves to the v2 SDK: one server now answers both the current protocol and 2025-era clients, and every tool declares an output schema and returns structured content, so an assistant reads typed fields instead of re-parsing a blob. `mcmc update` shows what it is doing: a download progress bar on a terminal, one line per step when piped, and silence under `--json`.
