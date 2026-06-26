# @mcmcjs/doodlebugs

Turn [DoodleBUGS](https://github.com/TuringLang/DoodleBUGS) graphs into BUGS / JuliaBUGS model code.

It is framework-free and meant to be the single source of truth for the codegen, shared by the DoodleBUGS editor and the [MCMC.js](https://github.com/mcmcjs/mcmcjs) CLI (`mcmc convert`), so the graph-to-model logic is not duplicated.

## What it provides

- **Parse** — read a saved graph and its data blob (`parseUnifiedModel`, `parseModelData`, `getElements`).
- **Order** — topologically sort the graph nodes (`buildTopologicalOrder`, Kahn's algorithm).
- **Generate** — emit classic BUGS `model { ... }` code (`generateBugsModel`): plates become `for` loops, stochastic/observed nodes become `~`, deterministic nodes become `<-`.
- **Validate** — surface graph issues such as cycles (`validateGraph`).
- **Catalog** — the supported distributions and BUGS functions (`DISTRIBUTIONS`, `BUGS_FUNCTIONS`).

> Early alpha: the API is not yet stable.

## License

[MIT](./LICENSE) © [Shravan Goswami](https://shravangoswami.com)
