# @mcmcjs/plots

MCMC diagnostic plots for [MCMC.js](https://github.com/mcmcjs/mcmcjs), built on the dependency-free [`@mcmcjs/charts`](../charts) engine.

It is split into a data layer and renderers: each `*Data` builder turns a `Samples` set into a plain, serializable object, and each renderer turns that object into a terminal view, an SVG, or a self-contained interactive HTML page.

## Plot kinds

trace, density, histogram, rank, autocorr, pair (scatter, with optional viridis color-by), energy, forest, ecdf, cumulative-mean, running-rhat, violin, chain-intervals (+ all), summary-table, and diagnostics-heatmap.

Data builders for the WebGL plots (`scatter3dData`, `splomData`, `parallelCoordsData`) also live here, dependency-free; the interactive renderers are in [`@mcmcjs/plots-gl`](../plots-gl).

## Backends

- **Terminal** — `render*Terminal`, using braille/ASCII via `@mcmcjs/charts`.
- **SVG** — `render*SVG`, standalone vector output.
- **HTML** — `buildHtmlDocument` emits one self-contained, offline page with [uPlot](https://github.com/leeoniya/uPlot) inlined for interactive charts (pan/zoom, PNG/SVG export); forest, pair, and the table/grid kinds embed their SVG.

The CLI exposes all of this through `mcmc plot --kind <kind> --format terminal|svg|html`.

> Early alpha: the API is not yet stable.

## License

[MIT](./LICENSE) © [Shravan Goswami](https://shravangoswami.com)
