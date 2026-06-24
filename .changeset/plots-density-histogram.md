---
"@mcmcjs/plots": minor
---

Add density and histogram plots. `densityData` computes a per-chain Gaussian KDE (Silverman bandwidth) over a shared grid; `histogramData` bins pooled draws with Freedman-Diaconis bin selection. `renderDensityTerminal` draws overlaid per-chain curves and `renderHistogramTerminal` draws filled columns, both through the `@mcmcjs/charts` engine.
