---
"@mcmcjs/plots": minor
---

Add the SPLOM (scatter-plot matrix): `splomData` builds an N x N grid with per-variable 1-D KDE diagonals, upper-triangle Pearson/Spearman correlations, and lower-triangle joint draws; `renderSplomSVG` draws the grid (KDE, correlation-tinted cells, chain-colored scatter) and `renderSplomTerminal` prints a compact correlation matrix.
