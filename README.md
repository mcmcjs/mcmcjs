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
mcmc setup                       # provision the Julia toolchain via juliaup
mcmc doctor                      # check the environment
mcmc fit model.toml -o out.json  # run inference from a spec
mcmc diagnose out.json           # diagnostics over the samples
mcmc julia version list          # manage installed Julia versions
```

Every command supports `--json` and uses exit codes 0 (ok), 1 (error), and 2
(ran, but a domain check failed, such as non-convergence in `diagnose`).

## Development

This is a [pnpm](https://pnpm.io) workspace.

```bash
pnpm install
```

## License

[MIT](./LICENSE) © [Shravan Goswami](https://shravangoswami.com)
