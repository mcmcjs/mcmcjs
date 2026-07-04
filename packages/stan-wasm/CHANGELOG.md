# @mcmcjs/stan-wasm

## 0.2.0

### Minor Changes

- c427d82: The compile client prefers a `main_js_url` field from the compile response as the worker module URL, falling back to the derived `download/<id>/main.js` path, and a new `getAuthToken` option resolves a bearer token per compile request while `passcode` stays for servers with a static secret. Both are threaded through `StanSampler` and the React entry.

## 0.1.0

### Minor Changes

- fb334ca: New package: run Stan models in the browser via a WebAssembly sampling runtime (TinyStan in a Web Worker), with a typed client for a Stan-to-WASM compile server and an optional React adapter.
