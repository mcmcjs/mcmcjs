# @mcmcjs/plots

## 0.4.0

### Minor Changes

- d136f5e: Carry chain identity into specs and move reference guides into a tagged channel. The per-chain `*Data` builders (`traceData`, `densityData`, `rankData`, `autocorrData`, `ecdfData`, `cumulativeMeanData`) accept an optional `chainIds`, so a caller that subsets chains keeps stable per-chain color and label; the uPlot spec builders now key color and label to chain identity rather than array position. `UplotSpec` gains a `refLines` channel and `UplotSeriesSpec` a `role: "chain"` tag: rank, autocorrelation, and running-R-hat specs now emit their guide lines (uniform, zero, 1.00/1.05) as `refLines` drawn by a plugin instead of trailing data series, so every data series is a real chain. The self-contained HTML export draws `refLines` via a draw plugin.

### Patch Changes

- Updated dependencies [8981a57]
- Updated dependencies [27d8e76]
  - @mcmcjs/charts@0.4.0

## 0.3.0

### Minor Changes

- 14156c3: Add violin, chain-intervals, and chain-intervals-all plots (terminal, SVG, and HTML). `violinData` reuses the density bandwidth for a peak-normalized KDE band per chain; `chainIntervalsData` and `chainIntervalsAllData` build per-chain and pooled q5/q25/q50/q75/q95 interval rows.
- e14778c: Add the parallel-coordinates plot: `parallelCoordsData` builds per-variable axis bounds and one capped, subsampled polyline per draw; `renderParallelCoordsSVG` draws the axes and chain-colored polylines and `renderParallelCoordsTerminal` prints a per-variable min/mean/max summary.
- c017f6b: Add the ecdf, cumulative-mean, and running-rhat plots (terminal, SVG, and interactive HTML). `ecdfData`, `cumulativeMeanData`, and `runningRhatData` build the data; running-rhat reuses the basic split-R-hat from `@mcmcjs/diagnostics` over an increasing prefix of draws.
- 5e84c07: Pair plots support an optional color-by-variable: `pairData(samples, x, y, { colorVar })` attaches a per-point color channel and `renderPairSVG` shades points through the viridis colormap with a gradient legend (color-by-chain remains the default).
- d62059c: Add the 3D scatter data builder: `scatter3dData(samples, varX, varY, varZ, opts?)` computes the global bounding box over all chains and subsamples each chain (even-stride, endpoints kept) to a per-chain cap, storing both raw draws (for tooltips) and NDC [-1, 1] draws (for WebGL projection and hit-testing) as plain serializable arrays.
- 521ee6c: Add the SPLOM (scatter-plot matrix): `splomData` builds an N x N grid with per-variable 1-D KDE diagonals, upper-triangle Pearson/Spearman correlations, and lower-triangle joint draws; `renderSplomSVG` draws the grid (KDE, correlation-tinted cells, chain-colored scatter) and `renderSplomTerminal` prints a compact correlation matrix.
- 0af8047: Add summary-table and diagnostics-heatmap views (terminal, SVG, and HTML). `summaryTableData` builds a full per-variable diagnostic row (mean, std, MCSE, quantiles, summed IMSE ESS, bulk/tail ESS, R-hat, classic split-R-hat, Geweke z, HDI); `diagnosticsHeatmapData` scores each variable across seven metrics and pre-colors the cells on a green/amber/red ramp.

### Patch Changes

- Updated dependencies [5e84c07]
- Updated dependencies [e2a349c]
- Updated dependencies [e2a349c]
- Updated dependencies [e2a349c]
- Updated dependencies [d76de33]
- Updated dependencies [25f73ff]
- Updated dependencies [af59faf]
- Updated dependencies [41b85d6]
- Updated dependencies [0af8047]
  - @mcmcjs/charts@0.3.0
  - @mcmcjs/core@0.6.0
  - @mcmcjs/diagnostics@0.4.0

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
