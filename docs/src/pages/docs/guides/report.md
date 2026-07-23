---
layout: ../../../layouts/DocsLayout.astro
title: Report
description: Open a run in the report web app, fully offline.
---

`mcmc report [ref]` opens a run in the report web app, a browser explorer with the full plot set, summary diagnostics, the model source, and the data.

```bash
mcmc run model.jl
mcmc report            # opens the latest run
mcmc report @2         # or any run ref
```

Every successful `mcmc run` also prints the report link for that run.

## How the data reaches the browser

Nothing is uploaded anywhere; the app is a static page and your samples stay on this machine.

- **Connected store** (Chromium browsers): the app asks once for read access to your `.mcmc` folder, remembers it, and from then on any `mcmc report` link opens instantly by reading the run from disk. The landing page also lists every run in the store.
- **Run bundles** (all browsers): `mcmc export bundle` writes a single self-contained file with the model, data, spec, and draws. Drop it on the app to open it anywhere.

```bash
mcmc export bundle -o coin_flip.mcmcrun.json
```

Opened runs are saved in the browser (IndexedDB), so past reports stay available offline with the CLI closed.

## Pointing at a different app

The link defaults to the hosted app. `--app-url` or the `MCMC_REPORT_APP` environment variable point it at a self-hosted or development copy.

```bash
MCMC_REPORT_APP=http://localhost:5173 mcmc report
```

<div class="callout note"><p>The app never sees your file system without permission: connecting the store is a one-time, read-only grant that you can revoke in the browser at any time.</p></div>
