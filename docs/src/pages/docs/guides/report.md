---
layout: ../../../layouts/DocsLayout.astro
title: Report
description: Open a run in the report web app, fully offline.
---

`mcmc report [ref]` opens a run in the report web app, a browser monitor with a variable sidebar, the summary table, convergence diagnostics, the full plot set, the model source, and the data.

```bash
mcmc run model.jl
mcmc report            # opens the latest run
mcmc report @2         # or any run ref
```

Every successful `mcmc run` also prints the report link for that run.

## How the data reaches the browser

Nothing is uploaded anywhere; the app is a static page and your samples stay on this machine.

- **Direct handoff** (the default for `mcmc report`): the CLI serves the run store on the loopback interface for up to two minutes with a single-use token, and the app picks the run up as soon as the link opens — no file access, no clicks. While the server is up the app also lists every run in the store, in any browser.

- **Watch mode**: `mcmc report --watch` keeps that server running until you stop it, so the app browses the whole store — every run, one click each — with no file pickers at all.
- **Connected store** (Chromium browsers): the app asks once for read access to your `.mcmc` folder, or any folder above it (grant your projects folder once and every store inside opens automatically), and from then on any `mcmc report` link opens instantly by reading the run from disk, with no CLI running. Browsers never let a page point the folder picker at a path, so the first grant is a manual pick; Ctrl+L pastes the path shown in the app.
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
