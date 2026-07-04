---
"@mcmcjs/stan-wasm": minor
---

The compile client prefers a `main_js_url` field from the compile response as the worker module URL, falling back to the derived `download/<id>/main.js` path, and a new `getAuthToken` option resolves a bearer token per compile request while `passcode` stays for servers with a static secret. Both are threaded through `StanSampler` and the React entry.
