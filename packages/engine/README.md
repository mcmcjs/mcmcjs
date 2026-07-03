# @mcmcjs/engine

The runtime and PPL engine contract for [MCMC.js](https://github.com/mcmcjs/mcmcjs).

It is a small, dependency-free set of types (`Engine`, `EngineCapabilities`, `HealthReport`, `RuntimeVersion`) plus a static registry and the shared subprocess-runner types (`CommandRunner`, `FitRunner`), letting each runtime or probabilistic programming language plug in as a composable unit.
Two engines, Julia and Stan, register through this contract today; others plug in the same way.

> Early alpha: the API is not yet stable.

## License

[MIT](./LICENSE) © [Shravan Goswami](https://shravangoswami.com)
