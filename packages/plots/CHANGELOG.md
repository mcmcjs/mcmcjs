# @mcmcjs/plots

## 0.2.0

### Minor Changes

- 43fd233: Add an interactive HTML backend. `buildHtmlDocument(data)` emits a single self-contained, offline-capable HTML file with the MIT-licensed uPlot bundle and CSS inlined, the plot specs embedded as JSON, and a bootstrap that rehydrates them into pan/zoom charts with per-plot PNG/SVG export. `htmlItemFor` builds function-free uPlot specs for the line/bar/step kinds and embeds existing SVG for forest and pair.

### Patch Changes

- Updated dependencies [4b38323]
  - @mcmcjs/charts@0.2.0

## 0.1.0

### Minor Changes

- cee37af: Add density and histogram plots. `densityData` computes a per-chain Gaussian KDE (Silverman bandwidth) over a shared grid; `histogramData` bins pooled draws with Freedman-Diaconis bin selection. `renderDensityTerminal` draws overlaid per-chain curves and `renderHistogramTerminal` draws filled columns, both through the `@mcmcjs/charts` engine.
- 0921877: Add the energy diagnostic plot (HMC/NUTS). `energyData` builds the centered marginal-energy and energy-transition distributions on shared bins plus per-chain E-BFMI from the `hamiltonian_energy` sampler stat; `renderEnergyTerminal` and `renderEnergySVG` overlay the two curves and report the E-BFMI.
- 22f607a: New package: a dependency-free plotting layer over `@mcmcjs/core` and `@mcmcjs/diagnostics`. It turns a `Samples` set into renderer-agnostic plot data (`traceData`, `forestData`) and renders it; the first renderer is a terminal one (Unicode braille trace lines with an ASCII fallback, and forest interval rows with HDI/IQR and convergence highlighting). Color is injected by the caller so the package itself stays dependency-free.
- e9cd91b: Add the pair (joint) plot: `pairData` pools two variables' draws with chain and divergence labels; `renderPairTerminal` draws a chain-colored scatter and `renderPairSVG` draws scatter points with divergent transitions highlighted in red (thinning dense runs while keeping every divergence).
- b382de5: Add rank and autocorrelation plots. `rankData` bins pooled average-ranks per chain (uniform bars indicate good mixing); `autocorrData` returns each chain's ACF via `@mcmcjs/diagnostics`. `renderRankTerminal` draws a per-chain sparkline and `renderAutocorrTerminal` draws decaying per-chain lines.
- af55da5: Add `renderRankSVG` (a stepped per-chain rank outline with a uniform-expectation reference line), completing the SVG renderer set so it matches the terminal set.
- 3b8c131: Add SVG renderers for trace, density, histogram, autocorrelation, and forest plots (`renderTraceSVG`, etc.), producing standalone publication-quality vector figures from the same plot data the terminal renderers use. Re-exports `stackSvg` for composing multiple figures.

### Patch Changes

- f61cb7b: Render the terminal plots through the new `@mcmcjs/charts` engine (shared canvas, scales, and frame) rather than bespoke per-plot code. No change to plot output.
- Updated dependencies [f61cb7b]
- Updated dependencies [3b8c131]
- Updated dependencies [b382de5]
  - @mcmcjs/charts@0.1.0
  - @mcmcjs/diagnostics@0.3.0
