---
"mcmcjs": minor
---

Add `mcmc sandbox --strict` (and `pnpm sandbox --strict`): a fully isolated sandbox that redirects the managed environment, Julia/juliaup depots, caches, and worker sockets inside the throwaway directory, so it starts with no Julia installed and `mcmc setup` provisions a fresh toolchain that vanishes on exit.
