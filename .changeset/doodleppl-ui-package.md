---
"doodleppl": minor
---

New package: embed the DoodlePPL graphical model editor anywhere. `new DoodlePPL({ element, ...options })` mounts the editor (registered as the `<doodle-ppl>` custom element) and bridges it to typed callbacks for editor state and generated BUGS/Stan code, with `getState`/`getGraph`/`setTheme`/`destroy` on the instance. The editor's widget source now lives in this package and loads as a lazy chunk, so the import itself adds only a few KB; a self-contained `dist/doodleppl.global.js` serves script-tag consumers.
