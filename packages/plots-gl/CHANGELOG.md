# @mcmcjs/plots-gl

## 0.2.4

### Patch Changes

- Updated dependencies [7d83dc5]
  - @mcmcjs/plots@0.6.0

## 0.2.3

### Patch Changes

- Updated dependencies [b361256]
- Updated dependencies [8b3551f]
  - @mcmcjs/plots@0.5.0

## 0.2.2

### Patch Changes

- Updated dependencies [824bf3c]
- Updated dependencies [cd96f4d]
- Updated dependencies [84cfd6b]
  - @mcmcjs/core@0.7.0
  - @mcmcjs/plots@0.4.2

## 0.2.1

### Patch Changes

- @mcmcjs/plots@0.4.1

## 0.2.0

### Minor Changes

- eba4666: Add per-chain visibility to the WebGL renderers. `GlPlotHandle` gains `setChainVisible(chain, show)` and `GlMountOptions` gains `hiddenChains`, so a host can drive click-to-toggle chain legends over the 3D scatter, SPLOM, and parallel-coordinates plots and set the initial hidden set. Toggling a chain hides every series that belongs to it across all SPLOM cells.

### Patch Changes

- Updated dependencies [d136f5e]
  - @mcmcjs/plots@0.4.0

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
