---
"@mcmcjs/charts": patch
---

Mount uPlot charts at a high-DPI `pxRatio` (default `max(2, devicePixelRatio)`, overridable via `MountOptions.pxRatio`) so lines stay crisp under browser zoom, and drive responsive resize with a rAF-debounced `ResizeObserver` (catching container resizes, not just window resizes) with a clean `resize`-listener fallback.
