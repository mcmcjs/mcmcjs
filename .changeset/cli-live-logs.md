---
"mcmcjs": minor
---

Stream live logs during the long phases instead of a static line: mcmc setup now shows juliaup's install output, and the "Preparing the Julia environment" step streams Pkg resolve/precompile output (both on stderr, so --json stays clean). A "starting Julia and loading Turing" indicator fills the brief silent gap before per-chain sampling progress.
