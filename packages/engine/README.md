# @mcmcjs/engine

The runtime and PPL engine contract for [MCMC.js](https://github.com/mcmcjs/mcmcjs):
a small, dependency-free set of types (`Engine`, `EngineCapabilities`,
`HealthReport`) and a static registry that let each runtime or probabilistic
programming language plug in as a composable unit. Julia is the first engine;
others register the same way.

> Early alpha: the API is not yet stable.

## License

[MIT](./LICENSE) (c) [Shravan Goswami](https://shravangoswami.com)
