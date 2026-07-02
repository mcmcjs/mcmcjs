# doodleppl

## 0.3.0

### Minor Changes

- 12fcee6: Export the bundled example catalog as `exampleModels` (with `ExampleModelConfig`), so hosts can list the models accepted by the `example` option.
- 970cce9: Add a `mode` option: `"embedded"` (default) keeps the maximize and edit toggles, `"fullpage"` pins the editor maximized with editing always on. Also fix three UI regressions: the debug console now layers above the sidebars, long graph names truncate with an ellipsis instead of forcing a horizontal scroll, and the collapsed right-sidebar maximize icon matches the size used everywhere else.
- 0b0e5d9: Render the editor canvas inside a shadow root so host page CSS cannot restyle it, and stop the widget from restyling the host page: the global `body`, `#app`, scrollbar, and placeholder rules are removed or scoped to the widget's own surfaces.

### Patch Changes

- 5c3e428: Fix the CDN build: `doodleppl.global.js` shipped bare `process.env.NODE_ENV` references and threw `process is not defined` when loaded from a script tag; the IIFE now bakes in production mode.

## 0.2.0

### Minor Changes

- 3b9a5a2: Expose the editor element on the `doodleppl/element` subpath: importing it registers `<doodle-ppl>` and exports the `DoodlePPLElement` class, so a host can mount the element declaratively or register an alias tag by subclassing.

## 0.1.2

### Patch Changes

- ed2f366: Ship the type declarations at the documented path: 0.1.1 published them under `dist/src/`, so TypeScript consumers resolved no types. Declarations are now emitted by `vue-tsc` alongside the build.

## 0.1.1

### Patch Changes

- Updated dependencies [c6f2c64]
  - @mcmcjs/doodleppl@0.2.1

## 0.1.0

### Minor Changes

- 75e1b32: New package: embed the DoodlePPL graphical model editor anywhere. `new DoodlePPL({ element, ...options })` mounts the editor (registered as the `<doodle-ppl>` custom element) and bridges it to typed callbacks for editor state and generated BUGS/Stan code, with `getState`/`getGraph`/`setTheme`/`destroy` on the instance. The editor's widget source now lives in this package and loads as a lazy chunk, so the import itself adds only a few KB; a self-contained `dist/doodleppl.global.js` serves script-tag consumers.

### Patch Changes

- Updated dependencies [a9fb706]
  - @mcmcjs/doodleppl@0.2.0
