# @mcmcjs/charts

A small, dependency-free plotting engine. It renders a renderer-agnostic figure
model to multiple backends — starting with the terminal (Unicode braille/block
with an ASCII fallback) and, ahead, headless SVG for publication-quality export.

The engine is domain-neutral: it knows about scales, axes, frames, canvases, and
plot primitives, not about any particular kind of data. `@mcmcjs/plots` builds on
it to render MCMC diagnostics, but the engine has no MCMC dependency.

## What it provides today

- `DotCanvas` — a braille dot grid (2x4 sub-pixels per cell) with `set`, `line`
  (Bresenham), and per-series colored `rows`, plus a plain-ASCII mode.
- `linearScale` / `niceDomain` — data-to-pixel mapping with inverse.
- `axisFrame` — wraps rendered body rows in a labeled, axed frame.
- `fmtNum` / `extent` — compact numeric labels and finite-range helpers.

Color is injected by the caller (`ColorFn`), so the package itself pulls in no
color or other runtime dependencies.

## Status

Early and evolving alongside MCMC.js. The API is not yet stable.

## License

MIT (c) Shravan Goswami
