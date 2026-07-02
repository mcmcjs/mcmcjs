---
"@mcmcjs/doodleppl": patch
---

Fix the generated JuliaBUGS run script erroring on models with inits: `initialize!` was called on the gradient-wrapped model (a MethodError in JuliaBUGS 0.15), and the inits never reached NUTS anyway. The script now initializes the plain model, wraps it with the AD type afterwards, and passes the transformed-space vector to `sample` via `initial_params`.
