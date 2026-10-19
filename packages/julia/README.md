# @mcmcjs/julia

The bridge to the Julia ecosystem for [MCMC.js](https://github.com/mcmcjs/mcmcjs).

It detects and bootstraps the Julia toolchain via juliaup, manages a pinned, per-user Julia project, and runs inference as a subprocess.

## What it provides

- **Toolchain** — detect juliaup and Julia (`detectJulia`/`detectJuliaup`), install them (`planSetup`/`runSetup`), and manage versions (`list`/`add`/`remove`/`default`/`update`/`gc`) over juliaup channels.
- **Managed project** — provision an isolated Julia project with Turing.jl and JuliaBUGS (and friends) and precompile it (`ensureProject`).
- **Existing project** — instantiate and precompile a matching `Project.toml` and `Manifest.toml` with `instantiateProject`. The Manifest must have been resolved for the Project and Julia minor version, and it stays unchanged. Its `beforePrecompile` hook runs after package installation, so callers can populate a Julia depot cache before precompilation.
- **Driver** — the `fit` and `predict` runner (`driver.jl`) that runs Turing or JuliaBUGS and writes the MCMCChains-JSON samples file plus a run record.
- **NUTS checkpoints** — `runFit` writes an immutable checkpoint for each Turing or JuliaBUGS chain at each draw-batch boundary. The matching batch carries its path and SHA-256. A chain can resume after verification with the same Julia version, Project, Manifest, model file, data, NUTS settings, and seed. Julia serialization is not a portable archive format.

> Early alpha: the API is not yet stable.

## License

[MIT](./LICENSE) © [Shravan Goswami](https://shravangoswami.com)
