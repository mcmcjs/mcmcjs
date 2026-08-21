# MCMC.js

Command-line tools for Bayesian modelling, MCMC inference, and post-inference diagnostics across probabilistic programming languages.

MCMC.js runs your model, checks whether the sampler converged, and shows you the result.
It works with Turing.jl, JuliaBUGS, and Stan, and it can install the toolchain for you.

> Early alpha: under active development. APIs and the CLI surface are not yet stable.

## Install

```bash
curl -fsSL https://mcmcjs.github.io/install.sh | sh   # single binary, no Node.js needed
npm i -g mcmcjs                                       # or from npm
```

Either way you get the `mcmc` command.
The libraries are published under the `@mcmcjs/*` scope on npm.

## Quickstart

```bash
mcmc setup                            # install the Julia toolchain
mcmc init demo                        # seed a directory with an example model
mcmc run demo/model.jl                # fit + diagnose, with live progress
mcmc plot --kind trace                # plot the latest run in the terminal
```

`mcmc run` records every run in a project-local `.mcmc/` store, so you can list, compare, and re-open runs later.
Every command supports `--json` and uses exit codes `0` (ok), `1` (error), and `2` (ran, but a domain check failed, such as non-convergence).

Run `mcmc --help` to see the full command list, or read the [documentation](https://mcmcjs.github.io/).

## Packages

| Package | Description |
| --- | --- |
| [`mcmcjs`](./packages/cli) | The command-line interface (`mcmc`). |
| [`@mcmcjs/core`](./packages/core) | Samples data model, spec format, samples-file parsers, and the run store/record. |
| [`@mcmcjs/diagnostics`](./packages/diagnostics) | Convergence diagnostics: split-R-hat, ESS, MCSE, HDI, Geweke, PSIS-LOO, WAIC. |
| [`@mcmcjs/engine`](./packages/engine) | Backend-neutral runtime/PPL contract and shared subprocess runners. |
| [`@mcmcjs/julia`](./packages/julia) | The Julia engine: toolchain provisioning, version management, and the fit/predict driver. |
| [`@mcmcjs/charts`](./packages/charts) | Dependency-free plotting engine: terminal (braille/ASCII) and SVG, plus a live uPlot DOM layer. |
| [`@mcmcjs/plots`](./packages/plots) | MCMC diagnostic plots over `@mcmcjs/charts`; terminal, SVG, and self-contained HTML. |
| [`@mcmcjs/plots-gl`](./packages/plots-gl) | Interactive WebGL renderers (3D scatter, SPLOM, parallel coordinates); `regl` optional peer. |
| [`@mcmcjs/stan`](./packages/stan) | The native Stan engine via a local CmdStan. |
| [`@mcmcjs/stan-wasm`](./packages/stan-wasm) | The browser Stan runtime: WASM sampler plus a compile-server client. |
| [`@mcmcjs/doodleppl`](./packages/doodleppl) | Turn a DoodlePPL graph into BUGS / JuliaBUGS and Stan model code. |
| [`doodleppl`](./packages/doodleppl-ui) | Embed the DoodlePPL graphical model editor anywhere. |

## Development

This is a [pnpm](https://pnpm.io) workspace.

```bash
pnpm install        # install deps
pnpm build          # build all packages (tsup)
pnpm test           # vitest run
pnpm typecheck      # tsc --noEmit
pnpm check          # biome lint + format
```

## License

[MIT](./LICENSE) © [Shravan Goswami](https://shravangoswami.com)
