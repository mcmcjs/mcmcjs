---
"mcmcjs": patch
---

Polish the live-logs work from review: the "starting" indicator is a plain newline-terminated line (no parked cursor, so it never garbles the daemon's worker notice on a shared terminal) and names the actual backend (Turing.jl or JuliaBUGS); and mcmc julia version add/remove/update/gc now stream juliaup's install output live like mcmc setup.
