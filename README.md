# MCMC.js

Command-line tools for Bayesian modelling, MCMC inference, and post-inference diagnostics with
[Turing.jl](https://github.com/TuringLang/Turing.jl) and
[JuliaBUGS.jl](https://github.com/TuringLang/JuliaBUGS.jl).

> Early alpha — under active development. APIs and the CLI surface are not yet stable.

## Packages

| Package | Description |
| --- | --- |
| [`mcmcjs`](./packages/cli) | The command-line interface (`mcmc`). |

Additional packages (`@mcmcjs/core`, `@mcmcjs/diagnostics`, and more) will live
in this monorepo as the ecosystem grows.

## Development

This is a [pnpm](https://pnpm.io) workspace.

```bash
pnpm install
```

## License

[MIT](./LICENSE) © [Shravan Goswami](https://shravangoswami.com)
