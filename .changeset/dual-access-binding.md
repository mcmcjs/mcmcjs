---
"@mcmcjs/julia": minor
---

Bind model data so a Turing model can read a variable either as a property (`data.y`) or by index (`data["y"]` / `data[:y]`), with `haskey` and `keys` supported, so models written in either idiom run unchanged. JuliaBUGS continues to receive a plain NamedTuple.
