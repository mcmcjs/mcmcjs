---
"@mcmcjs/plots": minor
---

Carry chain identity into specs and move reference guides into a tagged channel. The per-chain `*Data` builders (`traceData`, `densityData`, `rankData`, `autocorrData`, `ecdfData`, `cumulativeMeanData`) accept an optional `chainIds`, so a caller that subsets chains keeps stable per-chain color and label; the uPlot spec builders now key color and label to chain identity rather than array position. `UplotSpec` gains a `refLines` channel and `UplotSeriesSpec` a `role: "chain"` tag: rank, autocorrelation, and running-R-hat specs now emit their guide lines (uniform, zero, 1.00/1.05) as `refLines` drawn by a plugin instead of trailing data series, so every data series is a real chain. The self-contained HTML export draws `refLines` via a draw plugin.
