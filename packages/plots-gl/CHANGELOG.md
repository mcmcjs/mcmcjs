# @mcmcjs/plots-gl

## 0.1.0

### Minor Changes

- b758943: New package: interactive WebGL renderers backed by regl (an optional peer). `mountScatter3d` (orbit-camera 3D point cloud with hover hit-testing), `mountSplom` (Canvas2D KDE diagonal + correlation cells with a WebGL lower-triangle scatter), and `mountParallelCoords` (GPU polylines with pan/zoom over axis indices) each mount into a DOM element and return a `GlPlotHandle`. The pure mat4 camera helpers (`mat4Perspective`, `mat4LookAt`, `mat4Multiply`, `projectPt`) are exported and unit-tested; regl is loaded via dynamic import or an injected `{ regl }` factory and never bundled.

### Patch Changes

- Updated dependencies [e2a349c]
- Updated dependencies [e2a349c]
- Updated dependencies [e2a349c]
- Updated dependencies [d76de33]
- Updated dependencies [25f73ff]
- Updated dependencies [af59faf]
- Updated dependencies [41b85d6]
- Updated dependencies [0af8047]
- Updated dependencies [14156c3]
- Updated dependencies [e14778c]
- Updated dependencies [c017f6b]
- Updated dependencies [5e84c07]
- Updated dependencies [d62059c]
- Updated dependencies [521ee6c]
- Updated dependencies [0af8047]
  - @mcmcjs/core@0.6.0
  - @mcmcjs/diagnostics@0.4.0
  - @mcmcjs/plots@0.3.0
