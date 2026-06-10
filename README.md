# MCMC.js

Command-line tools for Bayesian modelling, MCMC inference, and post-inference
diagnostics across probabilistic programming languages.

> Early alpha: under active development. APIs and the CLI surface are not yet stable.

## Packages

| Package | Description |
| --- | --- |
| [`mcmcjs`](./packages/cli) | The command-line interface (`mcmc`). |
| [`@mcmcjs/core`](./packages/core) | Samples data model, spec format, and the run record. |
| [`@mcmcjs/diagnostics`](./packages/diagnostics) | Post-inference diagnostics: split-R-hat, ESS, MCSE, HDI. |
| [`@mcmcjs/engine`](./packages/engine) | Backend-neutral runtime/PPL contract and shared subprocess runners. |
| [`@mcmcjs/julia`](./packages/julia) | The Julia runtime engine: toolchain provisioning, version management, and the fit driver. |

Planned: `@mcmcjs/plots` and `@mcmcjs/doodlebugs` (not yet built).

## Install

```bash
npm i -g mcmcjs
```

This installs the `mcmc` binary. The libraries are published under the
`@mcmcjs/*` scope on npm.

## Usage

```bash
mcmc setup                            # provision the Julia toolchain via juliaup
mcmc doctor                           # check the environment
mcmc run model.jl --data data.csv     # fit + diagnose; artifacts go to the hidden .mcmc/ store
mcmc runs                             # list recorded runs and their verdicts
mcmc show                             # one run's settings, provenance, and artifacts
mcmc export samples                   # materialize a run's samples file when you need one
mcmc diagnose                         # re-check the latest run (or a file, or a run ref)
mcmc fit model.toml -o out.json       # plumbing: spec in, samples file out
mcmc julia version list               # manage installed Julia versions
```

`mcmc run` keeps the working directory clean: settings come from flags (or an
optional spec file you author), every run is recorded in a project-local
`.mcmc/` store, and re-running an unchanged model+data+settings reuses the
previous result (`--refit` to force).

Every command supports `--json` and uses exit codes 0 (ok), 1 (error), and 2
(ran, but a domain check failed, such as non-convergence in `diagnose`).

## Development

This is a [pnpm](https://pnpm.io) workspace.

```bash
pnpm install
```

## License

[MIT](./LICENSE) © [Shravan Goswami](https://shravangoswami.com)
