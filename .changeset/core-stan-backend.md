---
"@mcmcjs/core": minor
---

Specs accept `backend.id = "stan"`: the runtime and default version channel are now derived per backend (julia channels for Turing/JuliaBUGS, the local CmdStan install for Stan), with validation that backends run on their own runtime and that package pins stay julia-only.
