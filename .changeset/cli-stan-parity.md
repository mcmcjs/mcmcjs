---
"mcmcjs": minor
---

Stan reaches full command parity: `mcmc predict` works for Stan specs via generated quantities, `mcmc stan version list/add/remove` manages CmdStan installs, `mcmc fit --versions` runs a spec across CmdStan versions, `mcmc sandbox --strict` now isolates CmdStan alongside Julia, the sandbox and `mcmc init` templates include a Stan model, and a `.stan` model named next to a Julia-backend spec runs on the Stan engine with the spec's settings.
