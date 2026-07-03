# @mcmcjs/stan

## 0.1.0

### Minor Changes

- 4cec81d: New package: the native Stan engine. Resolves a local CmdStan install (managed, `~/.cmdstan`, or `MCMCJS_CMDSTAN`), compiles models through CmdStan's make with content-hash caching, runs NUTS with one process per chain, streams per-chain progress and draw batches by tailing the CSVs, and writes the standard samples file and run record. `runSetup` provisions CmdStan from the official release tarball.
- 2d321f0: Full engine parity: `runPredict` draws posterior-predictive samples through CmdStan's generate_quantities (the model's generated quantities block re-runs per posterior draw and `[predict].targets` selects the kept variables), `listVersions`/`addVersion`/`removeVersion` manage installed CmdStan versions, and `runMatrix` fits one spec across several CmdStan versions.

### Patch Changes

- Updated dependencies [824bf3c]
- Updated dependencies [cd96f4d]
- Updated dependencies [84cfd6b]
  - @mcmcjs/core@0.7.0
