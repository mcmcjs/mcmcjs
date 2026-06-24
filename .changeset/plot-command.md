---
"mcmcjs": minor
---

Add `mcmc plot [target]`, which renders MCMC diagnostic plots in the terminal for a run ref (latest, @N, id prefix) or a samples file, reusing the same resolution as `mcmc diagnose`. Supports `--kind trace|forest` (default forest), `--var` to filter parameters, `--ascii` for plain glyphs, `--hdi-prob`, `--width`/`--height`, `-o/--out` to write to a file, and `--json` to emit the underlying plot data.
