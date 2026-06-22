---
"@mcmcjs/julia": minor
---

Ship a committed, resolved Julia environment (Project.toml + Manifest.toml) and instantiate it for a fresh default provision, so every machine gets the exact same package versions instead of re-resolving the latest compatible ones. A `--versions` matrix or any package pin still resolves fresh. `mcmc setup` now installs the pinned Julia version (via the installer's default channel, or `juliaup add`).
