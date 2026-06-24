---
"@mcmcjs/plots": minor
---

Add an interactive HTML backend. `buildHtmlDocument(data)` emits a single self-contained, offline-capable HTML file with the MIT-licensed uPlot bundle and CSS inlined, the plot specs embedded as JSON, and a bootstrap that rehydrates them into pan/zoom charts with per-plot PNG/SVG export. `htmlItemFor` builds function-free uPlot specs for the line/bar/step kinds and embeds existing SVG for forest and pair.
