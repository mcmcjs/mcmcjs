# @mcmcjs/stan

The native Stan engine for [MCMC.js](https://github.com/mcmcjs/mcmcjs).

It resolves a local [CmdStan](https://mc-stan.org/docs/cmdstan-guide/) install, compiles Stan models through CmdStan's make with content-hash caching, and runs NUTS with one process per chain, streaming per-chain progress and draw batches.

## What it provides

- `stanEngine`: the engine descriptor with a `doctor` that reports CmdStan, stanc, make, and the C++ compiler.
- `runFit(spec, install, io)`: one inference run producing the standard samples file and run record, with `onProgress`/`onDraws` streaming and `AbortSignal` cancellation.
- `resolveCmdStan(version?)`: finds a CmdStan install; an explicit `MCMCJS_CMDSTAN`/`CMDSTAN` home wins, then the managed root, then `~/.cmdstan` shared with other Stan interfaces.
- `runSetup(options)`: provisions CmdStan from the official release tarball into the managed root and builds it once.
- `compileModel(install, modelPath)`: the cached model compile, reusable on its own.

## How a fit runs

The spec's canonical data is written to a temp `data.json` (the same JSON a Stan data block reads), one CmdStan process per chain samples with a shared seed and per-chain `id`, progress is parsed from CmdStan's iteration lines, and draws stream by tailing the growing CSVs.
When all chains finish, the CSVs are combined into the MCMC.js samples format via `@mcmcjs/core`.

## Requirements

CmdStan compiles models with the system toolchain: GNU make and a C++ compiler (g++ or clang++) must be installed.
`mcmc setup --engine stan` handles the CmdStan side; the compiler comes from your system package manager.

## License

MIT
