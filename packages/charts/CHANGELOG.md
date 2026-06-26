# @mcmcjs/charts

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
