---
"@mcmcjs/core": minor
---

Add Turing.jl CSV ingestion: `parseTuringCsv` (and `parseSamples` auto-detect) reads the wide `iteration,chain`, wide `chain_,draw_`, and headerless long `chain,variable,iteration,value` layouts. Non-numeric cells become NaN in place so the result stays rectangular.
