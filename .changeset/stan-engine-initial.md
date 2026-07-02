---
"@mcmcjs/stan": minor
---

New package: the native Stan engine. Resolves a local CmdStan install (managed, `~/.cmdstan`, or `MCMCJS_CMDSTAN`), compiles models through CmdStan's make with content-hash caching, runs NUTS with one process per chain, streams per-chain progress and draw batches by tailing the CSVs, and writes the standard samples file and run record. `runSetup` provisions CmdStan from the official release tarball.
