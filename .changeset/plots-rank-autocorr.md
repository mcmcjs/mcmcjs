---
"@mcmcjs/plots": minor
---

Add rank and autocorrelation plots. `rankData` bins pooled average-ranks per chain (uniform bars indicate good mixing); `autocorrData` returns each chain's ACF via `@mcmcjs/diagnostics`. `renderRankTerminal` draws a per-chain sparkline and `renderAutocorrTerminal` draws decaying per-chain lines.
