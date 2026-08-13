---
"mcmcjs": minor
---

The report app now pairs with the CLI instead of being handed a one-shot link: `mcmc report` runs a background store server on a stable port with a token the app remembers, so a reloaded or bookmarked tab reconnects on its own and lists every store you have reported from. The server caches preflights, idles out after 30 minutes, and is managed with `mcmc report status` and `mcmc report stop`; `mcmc run --report` opens a finished run straight away.
