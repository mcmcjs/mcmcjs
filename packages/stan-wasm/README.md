# @mcmcjs/stan-wasm

Run Stan models in the browser.
This package wraps [TinyStan](https://github.com/WardBrian/tinystan) compiled to WebAssembly in a Web Worker, adds a typed client for a Stan-to-WASM compile server, and ships an optional React adapter.

The design of the worker protocol and progress parsing follows the approach of [stan-playground](https://github.com/flatironinstitute/stan-playground) by the Flatiron Institute.

## Install

```bash
npm install @mcmcjs/stan-wasm
```

React is an optional peer dependency, only needed for the `./react` entry point.

## How it works

Stan models are compiled to WebAssembly by a compile server: the client posts Stan source to `POST /compile` and receives a model id, then the sampler loads the compiled module from `GET /download/<id>/main.js` inside a Web Worker and runs NUTS via TinyStan.
The compile server URL is always explicit; nothing is baked in.

## Quickstart

```ts
import { StanSampler } from "@mcmcjs/stan-wasm";

const sampler = new StanSampler({
  compileServerUrl: "http://localhost:8080",
});

await sampler.compile(stanCode);
const run = await sampler.sample({
  data,
  inits,
  num_chains: 4,
  num_warmup: 1000,
  num_samples: 1000,
  init_radius: 2,
});

console.log(run.paramNames, run.draws);
```

With Vite, pass the worker URL explicitly:

```ts
import workerUrl from "@mcmcjs/stan-wasm/worker?url";

const sampler = new StanSampler({ compileServerUrl, workerUrl });
```

## React

```ts
import { useStanWasmSampler, StanWasmSamplerProvider } from "@mcmcjs/stan-wasm/react";
```

The hook wraps the sampler in a compile/sample state machine; the provider shares one sampler through context.

## Browser requirements

Multithreaded WebAssembly needs `SharedArrayBuffer`, so the page must be served with:

```
Cross-Origin-Embedder-Policy: require-corp
Cross-Origin-Opener-Policy: same-origin
```

## License

MIT
