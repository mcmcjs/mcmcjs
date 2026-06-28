---
"@mcmcjs/charts": minor
---

Make the `@mcmcjs/charts/dom` interactive layer first-class. `MountSeries` gains `show` (initial visibility) and `role` ("chain" | "reference"); `MountSpec` gains a `refLines` channel so guide lines (e.g. an R-hat threshold) are drawn by a plugin instead of masquerading as trailing data series; `PlotHandle` gains `setSeriesVisible`, `toPng`, and an `uplot` escape hatch. `MountOptions` adds opt-in `interactive`/`modebar`/`tooltip`/`wheelZoom`/`pan`/`downsample`/`theme` flags that wire tree-shakeable plugins (hover modebar with pan, axis-zoom, zoom, reset, PNG export; cursor wheel-zoom and drag-pan; a colored-swatch tooltip), plus `downsampleAligned` and `lttb` downsamplers. The default chart stays bare uPlot; window listeners are removed on `destroy`.
