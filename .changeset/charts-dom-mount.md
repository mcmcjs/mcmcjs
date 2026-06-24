---
"@mcmcjs/charts": minor
---

Add the `@mcmcjs/charts/dom` subpath: `mountPlot(target, spec, { uPlot })` mounts an interactive uPlot chart into a live DOM element from a plain, function-free spec (path styles carried as `bars`/`stepped` flags) and returns a handle with `update`, `setSize`, `canvas`, and `destroy`. uPlot is an optional peer dependency, so the core package stays dependency-free.
