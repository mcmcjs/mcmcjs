---
layout: ../../../layouts/DocsLayout.astro
title: Plotting internals
description: The charts engine, the data-builder and renderer split, and the WebGL layer.
---

The plotting stack is three packages, layered so that the dependency-free core never pulls in a heavy dependency and the WebGL layer is fully optional.

```
@mcmcjs/charts     dependency-free engine: terminal + SVG (+ ./dom uPlot)
       ^
@mcmcjs/plots      MCMC data builders + terminal/SVG/HTML renderers
       ^
@mcmcjs/plots-gl   regl WebGL renderers (optional peer)
```

## `@mcmcjs/charts`: the engine

A small, dependency-free plotting engine that renders a renderer-agnostic figure model.
It is domain-neutral: it knows about scales, axes, frames, canvases, and plot primitives, not about MCMC.

- **Terminal** — `DotCanvas` (a braille 2x4 dot grid with `set`, `line`, and per-series colored rows, plus a plain-ASCII mode), `axisFrame`, `sparkline`, and `blockBar`.
- **SVG** — `svgFrame` and primitives (`svgPolyline`, `svgRect`, `svgLine`, `svgCircle`, `svgText`), plus `stackSvg` to compose figures.
- **Scales and helpers** — `linearScale`, `niceDomain`, `ticks`, `fmtNum`, `extent`, the `PALETTE` / `seriesColor` palette, and the viridis colormaps.

Color is injected by the caller (a `ColorFn`), so the core pulls in no runtime dependencies.
A separate browser-only subpath, `@mcmcjs/charts/dom`, mounts an interactive [uPlot](https://github.com/leeoniya/uPlot) chart into a live DOM element from a plain spec (`mountPlot`); uPlot is an optional peer dependency, so the dependency-free core is never affected.

## `@mcmcjs/plots`: the data-builder / renderer split

`@mcmcjs/plots` builds MCMC diagnostics on top of the engine, split into two layers:

- **Data builders.** Each `*Data` function turns a `Samples` set into a plain, serializable object: the numbers a plot needs, with no rendering. This is what `mcmc plot --json` emits.
- **Renderers.** Each renderer turns that object into one backend's output: `render*Terminal` (braille/ASCII via `@mcmcjs/charts`), `render*SVG` (standalone vector), and the HTML path.

`buildHtmlDocument` emits one self-contained, offline HTML page with uPlot inlined for the interactive charts (pan, zoom, PNG/SVG export); forest, pair, and the table and grid kinds embed their SVG.
Because the builders are serializable and dependency-free, the same data drives every backend, and a consumer can build the data once and render it anywhere.

## `@mcmcjs/plots-gl`: the WebGL layer

Three kinds have interactive WebGL renderers: a 3D point cloud (`scatter3d`), a scatter-plot matrix (`splom`), and parallel coordinates (`parallel-coords`).
They are browser-only and backed by [regl](https://github.com/regl-project/regl), an optional peer dependency.

Their data builders (`scatter3dData`, `splomData`, `parallelCoordsData`) live in the dependency-free `@mcmcjs/plots` package; only the interactive renderers live here.
That separation is the point: the terminal, SVG, and HTML backends never pull in WebGL, and the WebGL renderers load regl on demand.
Each mount function returns a handle for updating and teardown, mirroring `@mcmcjs/charts/dom`.
