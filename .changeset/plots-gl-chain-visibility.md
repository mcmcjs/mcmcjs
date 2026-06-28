---
"@mcmcjs/plots-gl": minor
---

Add per-chain visibility to the WebGL renderers. `GlPlotHandle` gains `setChainVisible(chain, show)` and `GlMountOptions` gains `hiddenChains`, so a host can drive click-to-toggle chain legends over the 3D scatter, SPLOM, and parallel-coordinates plots and set the initial hidden set. Toggling a chain hides every series that belongs to it across all SPLOM cells.
