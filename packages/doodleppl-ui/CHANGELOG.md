# doodleppl

## 0.5.1

### Patch Changes

- c3e6119: Keep the model-loading toast concise instead of printing a full local source URL

## 0.5.0

### Minor Changes

- 822a12a: Add a read-only mode, a localModel option to load a portable graph, and fit a loaded graph to the viewport

## 0.4.4

### Patch Changes

- eab12bf: Fix teleported PrimeVue chrome (left-sidebar accordion, dropdowns, and overlay panels) staying light in dark mode: re-emit PrimeVue's dark token remaps at `:host` scope in the overlay shadow root so its `:host`-anchored design tokens turn dark, and mirror the dark class onto the overlay host.

## 0.4.3

### Patch Changes

- 503701f: Fix dark mode painting the widget and its overlay solid red: toast and grid dark-mode selectors used :global() with a descendant selector, which Vue's scoped-CSS compiler compiles to a bare global .db-dark-mode rule.

## 0.4.2

### Patch Changes

- Updated dependencies [7919d5e]
  - @mcmcjs/doodleppl@0.2.2

## 0.4.1

### Patch Changes

- 0b4cc65: Fix invisible icons in 0.4.0: the primeicons `@font-face` never reached the document (its SVG font data contains literal braces that broke the regex-based extraction), leaving the edit, minimize, and toast-close glyphs blank. Font rules are now extracted with a real CSS parse and replayed into the head, where browsers require them.

## 0.4.0

### Minor Changes

- e9d32b3: Complete the CSS isolation in both directions: dialogs, select panels, and popovers now render inside the overlay shadow root via `appendTo`, toasts get an in-shadow display on the same toast service (PrimeVue's Toast cannot be re-targeted), and inherited text properties are reset at each shadow boundary. In the other direction the widget no longer injects its bundle CSS into the host document at all; only font registrations reach `document.head` (browsers ignore `@font-face` inside shadow roots), so the utility classes, CodeMirror styles, root token overrides, and PrimeVue input tweaks that previously leaked into host pages are gone. Tooltips remain the one light-DOM overlay (armored), since the tooltip directive has no retarget option.
- 9c5a9a6: Isolate the editor chrome from host page CSS: the toolbar, sidebars, floating panels, debug console, and context menu now render inside a shadow root on a body-level overlay host (still escaping host stacking contexts like the old body teleport), with the bundle CSS and PrimeVue's runtime styles mirrored in. PrimeVue popups that stay in the page (dialogs, dropdown panels, toasts, tooltips) get armor rules against blanket host resets on their close buttons and text.

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
