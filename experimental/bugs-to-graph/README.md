# Model to graph, experimental

The study, the oracles and the demo page behind `@mcmcjs/doodleppl/parse`,
`@mcmcjs/doodleppl/render` and `mcmc graph`. Nothing here is wired into the build.

## The page

```
node build-bundle.mjs                  # bundles parse, render and codegen into dist/graph.js
curl -sL -o vendor/stanc.js https://github.com/stan-dev/stanc3/releases/download/v2.39.0/stanc.js
python3 -m http.server 8124           # then open http://127.0.0.1:8124/viewer.html
```

**Editor** (`#editor`): write BUGS or Stan, or pick an example, and press Draw. The
program is parsed in the browser, laid out with dagre, drawn as SVG, and opened in a
DoodlePPL editor instance through a `blob:` document with the positions filled in.
Warnings say what the graph format could not hold. Stan is parsed by stanc3's own
browser build, `vendor/stanc.js`, fetched on first use; the walker reads the AST it
prints.

**Compare examples** (`#compare`): for each of the 50 BUGS examples, the `mcmc graph`
drawing, the widget opened on the Julia prototype's document, and the hand-drawn graph
bundled with the widget, side by side.

## What else is here

- `STUDY.md` takes apart what blocks turning a BUGS program into a graph, with counts
  over all 50 registered examples, and says where the parser should live and why.
- `graph.jl` is the Julia prototype that produced the first evidence, and the oracle the
  TypeScript parser was checked against. It stays until nothing needs it.
- `fixtures/programs.json` holds the 50 BUGS example programs with their data keys;
  `fixtures/stan-programs.json` holds Stan programs generated from the 15 bundled graphs
  plus eight schools; `fixtures/stan-asts.json` holds stanc3's AST for each, so the
  package tests need no stanc. The package tests keep their own copies.
- `render-all.mjs` runs `mcmc graph` over every BUGS program in svg, png and json.

## Why the obvious route fails

JuliaBUGS already turns BUGS into a graph: that is what `compile` does. But that graph
is unrolled to array elements, 367 vertices for Rats (`mu[5, 4]`, `alpha[3]`). The
widget wants one node per variable with `for` loops as plates, 9 nodes for Rats. The
source has to be the program text or its AST, where the loops still exist.
