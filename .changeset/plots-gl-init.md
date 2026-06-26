---
"@mcmcjs/plots-gl": minor
---

New package: interactive WebGL renderers backed by regl (an optional peer). `mountScatter3d` (orbit-camera 3D point cloud with hover hit-testing), `mountSplom` (Canvas2D KDE diagonal + correlation cells with a WebGL lower-triangle scatter), and `mountParallelCoords` (GPU polylines with pan/zoom over axis indices) each mount into a DOM element and return a `GlPlotHandle`. The pure mat4 camera helpers (`mat4Perspective`, `mat4LookAt`, `mat4Multiply`, `projectPt`) are exported and unit-tested; regl is loaded via dynamic import or an injected `{ regl }` factory and never bundled.
