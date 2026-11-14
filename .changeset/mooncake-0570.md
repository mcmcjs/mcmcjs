---
"@mcmcjs/julia": patch
---

Resolve the shipped Julia environment against Mooncake 0.5.70, whose gradients of `inv`, `det`, `logabsdet` and `\` on a dense matrix no longer drop the entries outside a triangle when the matrix is triangular.
