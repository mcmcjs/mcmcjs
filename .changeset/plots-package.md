---
"@mcmcjs/plots": minor
---

New package: a dependency-free plotting layer over `@mcmcjs/core` and `@mcmcjs/diagnostics`. It turns a `Samples` set into renderer-agnostic plot data (`traceData`, `forestData`) and renders it; the first renderer is a terminal one (Unicode braille trace lines with an ASCII fallback, and forest interval rows with HDI/IQR and convergence highlighting). Color is injected by the caller so the package itself stays dependency-free.
