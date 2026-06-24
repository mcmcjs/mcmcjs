---
"@mcmcjs/charts": minor
---

New package: a dependency-free plotting engine. It renders a renderer-agnostic figure to the terminal (a braille `DotCanvas` with an ASCII fallback), with linear scales, a reusable axed frame, and numeric formatting helpers. Color is injected by the caller, so the engine itself has no runtime dependencies. It is the domain-neutral foundation `@mcmcjs/plots` renders through, and the seed of a standalone terminal (and, ahead, SVG) charting library.
