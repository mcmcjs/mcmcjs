# doodleppl

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
