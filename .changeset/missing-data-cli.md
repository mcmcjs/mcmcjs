---
"mcmcjs": minor
---

Fit a model whose outcome is partly observed: `mcmc convert` writes the data to a JSON sidecar the TOML spec references, a run snapshots inline data the same way, dotted BUGS names in the data are renamed to match the generated model, and stan says why it cannot read an unobserved entry rather than handing CmdStan a null
