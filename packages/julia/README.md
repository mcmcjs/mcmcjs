# @mcmcjs/julia

The bridge to the Julia ecosystem for [MCMC.js](https://github.com/mcmcjs/mcmcjs).

It detects and bootstraps the Julia toolchain via juliaup, manages a pinned, per-user Julia project, and runs inference as a subprocess.

## What it provides

- **Toolchain** — detect juliaup and Julia (`detectJulia`/`detectJuliaup`), install them (`planSetup`/`runSetup`), and manage versions (`list`/`add`/`remove`/`default`/`update`/`gc`) over juliaup channels.
- **Managed project** — provision an isolated Julia project with Turing.jl and JuliaBUGS (and friends) and precompile it (`ensureProject`).
- **Driver** — the `fit` and `predict` runner (`driver.jl`) that runs Turing or JuliaBUGS and writes the MCMCChains-JSON samples file plus a run record.

> Early alpha: the API is not yet stable.

## License

[MIT](./LICENSE) © [Shravan Goswami](https://shravangoswami.com)
