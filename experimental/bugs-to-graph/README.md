# BUGS to graph, experimental

Turning a BUGS model back into a DoodlePPL graph document, so the widget can show
a graph for examples nobody has drawn by hand.

Nothing here is wired into the build. It writes JSON to its own `out/` directory.

## Why the obvious route fails

JuliaBUGS already turns BUGS into a graph: that is what `compile` does. But that
graph is unrolled to array elements. For Rats it has **367 nodes** (`mu[5, 4]`,
`alpha[3]`, `Y[6, 4]`), because every entry of every array is its own vertex.

DoodlePPL wants the *syntactic* graph: one node per variable, with `for` loops as
plates. Rats has 9 of those. So the source has to be the model AST, not the
compiled graph. Reaching for the compiled graph is the trap here.

## What breaks, measured over all 50 registered examples

| | count |
|---|---:|
| clean, no special handling | 22 |
| a hybrid node, both `~` and `=` on one variable | 14 |
| a computed index, e.g. `mu[group[i], t]` | 18 |
| plate nesting deeper than 2 | 7 |

Each of these turns out to be several distinct things once the statements are
listed, and most need nothing from the schema. `STUDY.md` takes them apart one by
one with counts, and says where the parser should live and why.

`viewer.html` shows every generated graph beside its hand-drawn counterpart in
the real widget: `python3 -m http.server 8124` in this directory, then open
`viewer.html`.

## Usage

```
julia --project=<JuliaBUGS.jl> graph.jl            # all examples
julia --project=<JuliaBUGS.jl> graph.jl rats air   # named ones
```
