# MCMC.js

Command-line tools for Bayesian modelling, MCMC inference, and post-inference diagnostics across probabilistic programming languages.

MCMC.js is a thin TypeScript orchestrator over the Julia PPL ecosystem (Turing.jl and JuliaBUGS).
It bootstraps Julia for you, runs inference as a subprocess, and turns the result into convergence diagnostics and plots, behind one consistent command-line surface designed for both humans and AI agents: structured `--json` output and clear exit codes everywhere.

> Early alpha: under active development. APIs and the CLI surface are not yet stable.

## Install

```bash
npm i -g mcmcjs
```

This installs the `mcmc` binary.
The libraries are published under the `@mcmcjs/*` scope on npm.

## Quickstart

```bash
mcmc setup                            # install the Julia toolchain via juliaup
mcmc init demo                        # seed a directory with an example model
mcmc run demo/model.jl                # fit + diagnose, with live progress
mcmc plot --kind trace                # plot the latest run in the terminal
```

## Usage

```bash
# Run inference
mcmc run model.jl --data data.csv     # fit + diagnose; artifacts go to .mcmc/
mcmc fit model.toml -o out.json       # plumbing: spec in, samples file out
mcmc predict model.toml samples.json  # posterior-predictive draws

# Inspect runs
mcmc runs                             # list recorded runs and their verdicts
mcmc show                             # one run's settings and artifacts
mcmc diagnose                         # R-hat / ESS / MCSE / HDI + a verdict
mcmc summary                          # a posterior summary table
mcmc plot --kind trace --format svg   # 16 plot kinds; terminal, svg, or html
mcmc samples --to mcmcchains-json     # export raw draws in a portable format

# Start a project
mcmc init                             # scaffold an example model
mcmc sandbox                          # try mcmcjs in a throwaway shell
mcmc convert graph.json               # DoodleBUGS graph -> model file + spec

# Toolchain
mcmc doctor                           # check the environment
mcmc julia version list               # manage installed Julia versions
```

`mcmc run` keeps the working directory clean: settings come from flags (or an optional spec file you author), every run is recorded in a project-local `.mcmc/` store, and re-running an unchanged model+data+settings reuses the previous result (`--refit` to force).

Every command supports `--json` (except the interactive `sandbox`) and uses exit codes `0` (ok), `1` (error), and `2` (ran, but a domain check failed, such as non-convergence).

## Packages

| Package | Description |
| --- | --- |
| [`mcmcjs`](./packages/cli) | The command-line interface (`mcmc`). |
| [`@mcmcjs/core`](./packages/core) | Samples data model, spec format, samples-file parsers, and the run store/record. |
| [`@mcmcjs/diagnostics`](./packages/diagnostics) | Convergence diagnostics: split-R-hat, ESS, MCSE, HDI, Geweke, correlation. |
| [`@mcmcjs/engine`](./packages/engine) | Backend-neutral runtime/PPL contract and shared subprocess runners. |
| [`@mcmcjs/julia`](./packages/julia) | The Julia engine: toolchain provisioning, version management, and the fit/predict driver. |
| [`@mcmcjs/charts`](./packages/charts) | Dependency-free plotting engine: terminal (braille/ASCII) and SVG, plus a live uPlot DOM layer. |
| [`@mcmcjs/plots`](./packages/plots) | MCMC diagnostic plots (trace, forest, rank, ...) over `@mcmcjs/charts`; terminal, SVG, and self-contained HTML. |
| [`@mcmcjs/plots-gl`](./packages/plots-gl) | Interactive WebGL renderers (3D scatter, SPLOM, parallel coordinates); `regl` optional peer. |
| [`@mcmcjs/doodlebugs`](./packages/doodlebugs) | Turn DoodleBUGS graphs into BUGS / JuliaBUGS model code. |

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
