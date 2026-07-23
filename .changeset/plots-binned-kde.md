---
"@mcmcjs/plots": patch
---

Corner-plot contours compute their 2-D KDE by linear binning plus a separable truncated-Gaussian convolution, the same construction as the reference KDE library, cutting an 8-variable corner from tens of seconds to under half a second.
