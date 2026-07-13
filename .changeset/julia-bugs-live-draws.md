---
"@mcmcjs/julia": minor
---

JuliaBUGS now streams draws live during sampling, like the Turing backend. Each batch carries named, constrained parameters, generated quantities, and sampler statistics, reconstructed to match the final samples file exactly.
