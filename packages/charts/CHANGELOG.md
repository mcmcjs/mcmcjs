# @mcmcjs/charts

## 0.5.0

### Minor Changes

- 95f5e5a: Theme mountPlot axes (labels, gridlines, ticks, border) from the theme preset, with axisColor, gridColor, and font overrides for exact palettes

## 0.4.0

### Minor Changes

- 27d8e76: Make the `@mcmcjs/charts/dom` interactive layer first-class. `MountSeries` gains `show` (initial visibility) and `role` ("chain" | "reference"); `MountSpec` gains a `refLines` channel so guide lines (e.g. an R-hat threshold) are drawn by a plugin instead of masquerading as trailing data series; `PlotHandle` gains `setSeriesVisible`, `toPng`, and an `uplot` escape hatch. `MountOptions` adds opt-in `interactive`/`modebar`/`tooltip`/`wheelZoom`/`pan`/`downsample`/`theme` flags that wire tree-shakeable plugins (hover modebar with pan, axis-zoom, zoom, reset, PNG export; cursor wheel-zoom and drag-pan; a colored-swatch tooltip), plus `downsampleAligned` and `lttb` downsamplers. The default chart stays bare uPlot; window listeners are removed on `destroy`.

### Patch Changes

- 8981a57: Mount uPlot charts at a high-DPI `pxRatio` (default `max(2, devicePixelRatio)`, overridable via `MountOptions.pxRatio`) so lines stay crisp under browser zoom, and drive responsive resize with a rAF-debounced `ResizeObserver` (catching container resizes, not just window resizes) with a clean `resize`-listener fallback.

## 0.3.0

### Minor Changes

- 5e84c07: Add a generic viridis colormap helper: `viridisRgb`, `viridisHex`, `viridisCss`, and the `VIRIDIS_STOPS` anchors.

## 0.2.0

### Minor Changes

- 4b38323: Add the `@mcmcjs/charts/dom` subpath: `mountPlot(target, spec, { uPlot })` mounts an interactive uPlot chart into a live DOM element from a plain, function-free spec (path styles carried as `bars`/`stepped` flags) and returns a handle with `update`, `setSize`, `canvas`, and `destroy`. uPlot is an optional peer dependency, so the core package stays dependency-free.

## 0.1.0

### Minor Changes

- f61cb7b: New package: a dependency-free plotting engine. It renders a renderer-agnostic figure to the terminal (a braille `DotCanvas` with an ASCII fallback), with linear scales, a reusable axed frame, and numeric formatting helpers. Color is injected by the caller, so the engine itself has no runtime dependencies. It is the domain-neutral foundation `@mcmcjs/plots` renders through, and the seed of a standalone terminal (and, ahead, SVG) charting library.
- 3b8c131: Add an SVG backend for publication-quality vector output: `svgFrame` (an axed frame with nice-number ticks and optional categorical row labels), primitives (`svgPolyline`, `svgRect`, `svgLine`, `svgCircle`, `svgText`), nice-number `ticks`, a categorical `PALETTE`/`seriesColor`, and `stackSvg` to compose several plots into one document. Still dependency-free.
