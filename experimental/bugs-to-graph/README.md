# BUGS to graph, experimental

The study and the oracles behind `@mcmcjs/doodleppl/parse`, `@mcmcjs/doodleppl/render`
and `mcmc graph`. Nothing here is wired into the build.

- `STUDY.md` takes apart what blocks turning a BUGS program into a graph, with counts
  over all 50 registered examples, and says where the parser should live and why.
- `graph.jl` is the Julia prototype that produced the first evidence. It walks the model
  AST with JuliaBUGS's parser, and it served as the oracle the TypeScript parser was
  checked against. It stays until nothing needs it.
- `fixtures/programs.json` holds the 50 example programs with their data keys; the
  package tests keep their own copy.
- `render-all.mjs` runs `mcmc graph` over every program in svg, png and json.
- `viewer.html` shows, per example, the `mcmc graph` drawing, the widget opened on the
  prototype's document, and the hand-drawn graph bundled with the widget:
  `python3 -m http.server 8124` in this directory, then open `viewer.html`.

## Why the obvious route fails

JuliaBUGS already turns BUGS into a graph: that is what `compile` does. But that graph
is unrolled to array elements, 367 vertices for Rats (`mu[5, 4]`, `alpha[3]`). The
widget wants one node per variable with `for` loops as plates, 9 nodes for Rats. The
source has to be the program text or its AST, where the loops still exist.
