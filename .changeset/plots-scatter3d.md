---
"@mcmcjs/plots": minor
---

Add the 3D scatter data builder: `scatter3dData(samples, varX, varY, varZ, opts?)` computes the global bounding box over all chains and subsamples each chain (even-stride, endpoints kept) to a per-chain cap, storing both raw draws (for tooltips) and NDC [-1, 1] draws (for WebGL projection and hit-testing) as plain serializable arrays.
