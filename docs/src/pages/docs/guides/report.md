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
mcmc run model.jl --report   # fit and open in one step
```

A finished `mcmc run` points at the command rather than printing a link, because the link only works while the store server is up and `mcmc report` is what brings it up.

## How the data reaches the browser

Nothing is uploaded anywhere; the app is a static page and your samples stay on this machine.

`mcmc report` starts a small store server on the loopback interface, on port 7788, and hands the app that port and a token.
The app saves both, so the pairing survives: reload the tab, bookmark it, or come back tomorrow, and it reconnects and lists your runs without another link.
The first time, the browser asks to allow local network access; allow it once and every later run opens straight away.

The server keeps running in the background after the command exits, shuts itself down after 30 minutes idle, and can be managed directly:

```bash
mcmc report status     # port and pid, or "not running"
mcmc report stop       # shut it down now
```

It serves every store you have reported from, so several projects share one server, and `mcmc doctor` mentions it whenever it is up.

Two fallbacks cover what a local port cannot:

- **Connected store** (Chromium browsers): the app asks once for read access to your `.mcmc` folder, or any folder above it (grant your projects folder once and every store inside opens automatically), and from then on any `mcmc report` link opens by reading the run from disk, with no CLI running. Browsers never let a page point the folder picker at a path, so the first grant is a manual pick; Ctrl+L pastes the path shown in the app.
- **Run bundles** (all browsers, any machine): `mcmc export bundle` writes a single self-contained file with the model, data, spec, and draws. Drop it on the app to open it anywhere. This is the route for a fit that ran on a remote box.

```bash
mcmc export bundle -o coin_flip.mcmcrun.json
```

Opened runs are saved in the browser (IndexedDB), so past reports stay available offline with the CLI closed.

## Pointing at a different app

The link defaults to the hosted app. `--app-url` or the `MCMC_REPORT_APP` environment variable point it at a self-hosted or development copy.

```bash
MCMC_REPORT_APP=http://localhost:5173 mcmc report
```

<div class="callout note"><p>The store server answers read-only GETs on the loopback interface, under a token kept in <code>~/.local/share/mcmcjs/report/</code>, and only pages from an app origin you have reported to can read its replies. Stop it any time with <code>mcmc report stop</code>.</p></div>
