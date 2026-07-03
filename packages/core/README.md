# @mcmcjs/core

The shared data substrate for [MCMC.js](https://github.com/mcmcjs/mcmcjs).

It defines the in-memory `Samples` model (chain-major draws plus sampler statistics) and the readers and writers around it, so every other package speaks one representation.

## What it provides

- **Samples model** — `Samples`, `chainView`, and helpers for working with draws across chains and variables.
- **Samples parsers** — `parseSamples` auto-detects MCMCChains JSON, ArviZ InferenceData JSON, and Turing CSV; plus `fromStanCSV`/`fromStanCSVFiles`, `fromChainArrays`, and `toMCMCChainsJson`/`toChainArrays` for round-tripping.
- **Spec format** — `parseSpec` reads the declarative run specification (TOML primary, JSON accepted), validated with zod; specs target an engine via `backend.id` (`julia` or `stan`).
- **Run store** — the project-local `.mcmc/` store: run records, the ledger, and run-reference resolution (`latest`, `@N`, id prefixes).

> Early alpha: the API is not yet stable.

## License

[MIT](./LICENSE) © [Shravan Goswami](https://shravangoswami.com)
