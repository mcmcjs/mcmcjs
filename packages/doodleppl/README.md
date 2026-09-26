# @mcmcjs/doodleppl

Turn a DoodlePPL graph into probabilistic model code: BUGS / JuliaBUGS and Stan.

It is framework-free and meant to be the single source of truth for the codegen, shared by the DoodlePPL graph editor and the [MCMC.js](https://github.com/mcmcjs/mcmcjs) CLI (`mcmc convert`), so the graph-to-model logic is not duplicated.

## What it provides

- **Parse** — read a saved graph and its data blob (`parseUnifiedModel`, `parseModelData`, `getElements`).
- **Order** — topologically sort the graph nodes (`buildTopologicalOrder`, Kahn's algorithm).
- **Generate** — emit classic BUGS `model { ... }` code (`generateBugsModel`): plates become `for` loops, stochastic/observed nodes become `~`, deterministic nodes become `<-`.
- **Validate** — surface graph issues such as cycles (`validateGraph`).
- **Draw** — a black-and-white figure of the graph for papers, as TikZ or SVG (`figureTikz`, `figureSvg` from `@mcmcjs/doodleppl/figure`).
- **Catalog** — the supported distributions and BUGS functions (`DISTRIBUTIONS`, `BUGS_FUNCTIONS`).

> Early alpha: the API is not yet stable.

## License

[MIT](./LICENSE) © [Shravan Goswami](https://shravangoswami.com)
