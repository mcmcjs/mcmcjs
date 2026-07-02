# doodleppl

Embed the DoodlePPL graphical model editor in any page or app.
Draw a probabilistic graphical model on a canvas; get live BUGS and Stan model code through typed callbacks.

The editor loads lazily: importing the package adds a few KB to your bundle, and the editor itself (Vue, Cytoscape, styles) loads as a separate chunk on first mount.
Only need codegen and validation without the editor? That is [`@mcmcjs/doodleppl`](https://www.npmjs.com/package/@mcmcjs/doodleppl).

## Usage

```bash
npm install doodleppl
```

```js
import { DoodlePPL } from "doodleppl";

const editor = new DoodlePPL({
  element: "#editor",
  example: "rats",
  theme: "dark",
  onStateChange: (state) => save(state),
  onBugsCode: (code) => console.log(code),
  onStanCode: (code) => console.log(code),
});

await editor.ready;
editor.getGraph(); // the current graph as a portable model document
```

Or from a script tag, one self-contained file:

```html
<script src="https://unpkg.com/doodleppl/dist/doodleppl.global.js"></script>
<div id="editor" style="height: 600px"></div>
<script>
  new DoodlePPL({ element: "#editor", example: "rats" });
</script>
```

## API

`new DoodlePPL(options)` mounts the editor into `options.element` (a selector or an element).

| Option | Purpose |
| --- | --- |
| `state` | Initial editor state: a prior `onStateChange`/`onReady` payload (object or JSON string). |
| `example` | Bundled example model to open (e.g. `"rats"`). |
| `theme` | `"light"` or `"dark"`. |
| `storageKey` | localStorage key for the editor's persistence. |
| `width`, `height` | CSS size (defaults: 100% x 600px). |
| `attributes` | Extra attributes passed to the underlying element. |
| `onReady`, `onStateChange` | Editor state callbacks. |
| `onBugsCode`, `onStanCode` | Regenerated model code callbacks. |

Instance: `ready` (promise), `getState()`, `getGraph()`, `setTheme(theme)`, `destroy()`.

## Provenance

The editor originated as [DoodleBUGS](https://github.com/TuringLang/JuliaBUGS.jl) (MIT, TuringLang contributors); its widget source now lives here and its codegen in `@mcmcjs/doodleppl`.
