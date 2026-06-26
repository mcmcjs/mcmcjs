---
layout: ../../../layouts/DocsLayout.astro
title: Plot
description: Render diagnostic plots to the terminal, SVG, or interactive HTML.
---

`mcmc plot [target]` renders MCMC diagnostic plots from a samples file.
Like the diagnostics commands it is pure TypeScript, reads the same samples files and run refs, and shares `--store`, `--stdin`, `--warmup`, and `--var`.

```bash
mcmc plot --kind trace
mcmc plot --kind forest --format html -o forest.html
```

## Plot kinds

Choose one with `--kind` (default `forest`).
There are 19 kinds:

`trace`, `density`, `histogram`, `rank`, `autocorr`, `pair`, `scatter`, `energy`, `forest`, `ecdf`, `cumulative-mean`, `running-rhat`, `violin`, `chain-intervals`, `chain-intervals-all`, `summary-table`, `diagnostics-heatmap`, `splom`, `parallel-coords`.

A terminal `forest` plot looks like this:

```
parameter  mean & 94% HDI                         R-hat
alpha                       ────━●━━────         1.006   2.054  [1.601, 2.516]
beta                                        ─●─  1.003   2.991  [2.918, 3.064]
sigma     ─━●━─                                  1.002   0.344  [0.183, 0.528]
```

## Output formats

`--format` chooses the renderer (default `terminal`):

- **terminal** — Unicode braille and block glyphs printed to the terminal, with `--ascii` for a plain-ASCII fallback. `--width` and `--height` are in characters.
- **svg** — standalone, publication-quality vector output. `--width` and `--height` are in pixels.
- **html** — one self-contained, offline HTML page. Interactive charts (trace, density, and the like) embed [uPlot](https://github.com/leeoniya/uPlot) inline for pan, zoom, and PNG/SVG export; forest, pair, and the table and grid kinds embed their SVG.

```bash
mcmc plot --kind trace --format svg -o trace.svg
mcmc plot --kind trace --format html -o trace.html
```

<div class="callout note"><p>The HTML export is fully self-contained: open it in any browser with no network and no server. Nothing is fetched from a CDN.</p></div>

## Selecting variables and tuning

| Flag | Meaning |
| --- | --- |
| `--var <name...>` | restrict to these variables (default: all) |
| `--hdi-prob <value>` | HDI credible mass for `forest` (default 0.94) |
| `--bins <n>` | histogram/rank bins (default: Freedman-Diaconis, or 20) |
| `--max-lag <n>` | autocorrelation max lag (default 40) |
| `--color-by <var>` | color scatter points by a third variable via viridis (svg/html) |
| `-o, --out <file>` | write the rendered plot to a file instead of stdout |
| `--json` | print the underlying plot data as JSON instead of rendering |

`--json` is the data-builder output: the serializable object the renderers consume, useful if you want to render it yourself.

## Interactive 3D in the browser

Three kinds, `splom` (scatter-plot matrix), `parallel-coords`, and a 3D point cloud, have interactive WebGL renderers in the separate `@mcmcjs/plots-gl` package, backed by [regl](https://github.com/regl-project/regl).
The CLI builds their data; mounting the interactive renderer into a live DOM element is a library call.
See [Plotting internals](/docs/dev/plotting/) for the data-builder and renderer split.
