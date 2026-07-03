# mcmcjs

Command-line tools for Bayesian modelling, MCMC inference, and post-inference diagnostics across probabilistic programming languages.

This is the `mcmc` CLI: a thin TypeScript orchestrator that bootstraps Julia or CmdStan, runs Turing.jl / JuliaBUGS / Stan inference as a subprocess, and turns the result into diagnostics and plots.
Every command supports `--json` and clear exit codes (`0` ok, `1` error, `2` ran-but-domain-check-failed), so it works for both humans and AI agents.

> Early alpha: under active development. The CLI surface is not yet stable.

## Install

```bash
npm install -g mcmcjs
```

## Commands

```bash
# Run inference
mcmc run model.jl --data data.csv     # fit + diagnose, recorded in .mcmc/
mcmc fit model.toml -o out.json       # spec in, samples file out
mcmc predict model.toml samples.json  # posterior-predictive draws

# Inspect runs
mcmc runs / show / diagnose           # list runs; show one; convergence verdict
mcmc summary                          # posterior summary table
mcmc plot --kind trace                # 19 plot kinds; terminal, svg, or html
mcmc samples                          # export raw draws as portable JSON

# Project + toolchain
mcmc init / sandbox                   # scaffold or try an example model
mcmc convert graph.json               # DoodleBUGS graph -> model file + spec
mcmc setup / doctor                   # install and check the Julia toolchain
mcmc setup --engine stan              # download and build CmdStan instead
mcmc julia version list               # manage installed Julia versions
mcmc stan version list                # manage installed CmdStan versions
```

Run `mcmc <command> --help` for a command's options.

## License

[MIT](./LICENSE) © [Shravan Goswami](https://shravangoswami.com)
