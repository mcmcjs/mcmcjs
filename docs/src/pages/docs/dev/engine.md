---
layout: ../../../layouts/DocsLayout.astro
title: Engine contract
description: The runtime and PPL engine contract that lets backends plug in.
---

`@mcmcjs/engine` is a small, dependency-free set of types that lets each runtime or PPL backend plug into MCMC.js as a composable unit.
Julia and Stan plug in through it today; further engines register the same way.

## The `Engine` interface

An engine describes itself and reports its own health.

```ts
interface Engine {
  readonly id: string;
  readonly displayName: string;
  readonly capabilities: EngineCapabilities;
  doctor(ctx: EngineContext): Promise<HealthReport>;
}
```

`doctor` is given an `EngineContext` (a `CommandRunner` and the platform) and returns a `HealthReport`, so `mcmc doctor` and `mcmc engines` work uniformly across engines.

## Capabilities

`EngineCapabilities` is a flat set of booleans, one per workflow step the engine supports:

```ts
interface EngineCapabilities {
  setup: boolean;
  versions: boolean;
  fit: boolean;
  predict: boolean;
}
```

Both engines report all four, which is what `mcmc engines` prints:

```
julia    ready  setup, versions, fit, predict
stan     ready  setup, versions, fit, predict
```

## Health and versions

```ts
interface HealthReport {
  engineId: string;
  ready: boolean;
  tools: NamedToolInfo[];
  hint?: string; // guidance shown when not ready
}

interface RuntimeVersion {
  id: string;       // channel or version, e.g. "release" or "1.10"
  version?: string;
  path?: string;
  isDefault: boolean;
}
```

`HealthReport.tools` lists the detected tools and their versions and paths; `hint` carries guidance when the engine is not ready.

## The registry

`createRegistry(defaultId)` returns an `EngineRegistry` with `register(engine)` and lookup.
Registering an engine is all it takes for the CLI's engine-agnostic commands (`doctor`, `engines`) to see it.

## The runner types

The engine package also defines the shared subprocess-runner contract that the Julia and Stan engines implement:

- **`CommandRunner`** — `(command, args) => Promise<string>`, a one-shot capture used for detection and short commands.
- **`FitRunner`** — runs an inference subprocess, capturing stdout, stderr, and exit code without throwing on a nonzero exit, with optional `onProgress` and `onDraws` callbacks and an `AbortSignal` for cancellation.
- **`FitProgress`** and **`DrawBatch`** — the streamed shapes: per-chain progress, and batches of sampled draws (one batch per line as NDJSON) that a consumer can resume from by `seq`.

Keeping these in `@mcmcjs/engine` means the orchestrator depends on the contract, not on any one backend.
The Julia implementation lives in `@mcmcjs/julia` and the Stan implementation in `@mcmcjs/stan`; see [Julia driver](/docs/dev/julia/) and [Stan engine](/docs/dev/stan/).
