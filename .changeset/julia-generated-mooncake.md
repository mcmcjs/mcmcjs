---
"@mcmcjs/julia": minor
---

JuliaBUGS fits with no evaluation mode or AD backend set run on the generated log density under Mooncake, checked against finite differences at the start and falling back to ForwardDiff on the graph, and compile from the spec's starting values so a vague prior draw can no longer break compilation.
