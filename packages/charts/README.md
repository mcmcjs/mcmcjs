# @mcmcjs/charts

A small, dependency-free plotting engine.
It renders a renderer-agnostic figure model to the terminal (Unicode braille/block with an ASCII fallback) and to headless SVG for publication-quality export.

The engine is domain-neutral: it knows about scales, axes, frames, canvases, and plot primitives, not about any particular kind of data.
`@mcmcjs/plots` builds on it to render MCMC diagnostics, but the engine has no MCMC dependency.

## What it provides

- **Terminal** — `DotCanvas` (a braille 2x4 dot grid with `set`, `line`, and per-series colored `rows`, plus a plain-ASCII mode), `axisFrame`, `sparkline`, and `blockBar`.
- **SVG** — `svgFrame` and primitives (`svgPolyline`, `svgRect`, `svgLine`, `svgCircle`, `svgText`), plus `stackSvg` to compose figures.
- **Scales and helpers** — `linearScale`, `niceDomain`, `ticks`, `fmtNum`, `extent`, and the `PALETTE`/`seriesColor` and `viridis*` colormaps.

Color is injected by the caller (`ColorFn`), so the core pulls in no runtime dependencies.

## `@mcmcjs/charts/dom`

A separate browser-only subpath mounts an interactive [uPlot](https://github.com/leeoniya/uPlot) chart into a live DOM element from a plain spec (`mountPlot`).
uPlot is an optional peer dependency, so the dependency-free core is never affected.

> Early alpha: the API is not yet stable.

## License

[MIT](./LICENSE) © [Shravan Goswami](https://shravangoswami.com)
