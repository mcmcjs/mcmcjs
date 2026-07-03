---
"@mcmcjs/stan": minor
---

Full engine parity: `runPredict` draws posterior-predictive samples through CmdStan's generate_quantities (the model's generated quantities block re-runs per posterior draw and `[predict].targets` selects the kept variables), `listVersions`/`addVersion`/`removeVersion` manage installed CmdStan versions, and `runMatrix` fits one spec across several CmdStan versions.
