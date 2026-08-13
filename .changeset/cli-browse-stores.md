---
"mcmcjs": patch
---

The browser now finds runs wherever they were recorded. `mcmc run` puts its store beside the model, so a run launched from a subdirectory used to leave the list reading "Runs 0"; every store under the project is read now, newest run first, and each one opens against its own store. An exported run bundle is also no longer mistaken for a spec just because it carries a schema_version.
