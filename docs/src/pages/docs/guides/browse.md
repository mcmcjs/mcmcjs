---
layout: ../../../layouts/DocsLayout.astro
title: Browse interactively
description: Explore a project's runs and models from a terminal browser that filters, inspects, plots, and launches fits.
---

`mcmc browse` opens an interactive browser over the project: the runs recorded in the store and the model files on disk.
Typing `mcmc` on its own does the same thing when a terminal is attached; piped or redirected, bare `mcmc` still prints the command help, so scripts are unaffected.

```bash
mcmc browse
```

## The picker

The box lists one scope at a time and filters as you type.

```
┌─  Runs 9   Models 2  ──────────────────────────────────────────────┐
│ ▸ gibbs                                                            │
├────────────────────────────────────────────────────────────────────┤
│ ❯ @2   model.jl      Gibbs 300x2              not converged · 5h ago│
│   @9   model.jl      Gibbs 300x2              not converged · 5h ago│
└ left/right scope · up/down pick · enter open · esc quit ───────────┘
```

Every word you type has to appear somewhere in the row, in any order: a run matches on its ref, id, model path, sampler, backend, and verdict, so `gibbs failed` finds failed Gibbs runs.
Left and right switch between Runs and Models, up and down move, enter opens, and escape leaves.

Verdicts are colored: green for converged, red for a failed or unconverged run, yellow for a cancelled one.

## What you can do with a run

Opening a run gives a menu that reuses the same code as the standalone commands, so what you see matches `mcmc summary`, `mcmc diagnose`, and friends:

- **Summary** and **Diagnostics**: the posterior table and the convergence table.
- **Variables**: every variable with its mean, sd, R-hat, ESS, and a sparkline of chain 1, so a stuck chain shows up as a flat line. Picking one draws its trace and density.
- **Plots**: any of the plot kinds that need only the draws, rendered in the terminal.
- **Settings and artifacts**: the same detail `mcmc show` prints.
- **Report link**: the report web-app deep link for the run.
- **Run again**: refits from the run's frozen spec, so the settings are exactly the ones that produced it.
- **Delete**: removes the run from the ledger and deletes its directory, after a confirmation.

Escape backs out one level rather than quitting, so exploring is cheap.

## What you can do with a model

The Models scope lists the `.jl` and `.stan` files and the spec files under the project, each with the number of runs recorded from it.
From there you can run the model, read the file, or jump to just that model's runs.

Launching a run from the browser runs the real `mcmc run`, streaming progress the same way, and the new run appears in the list when it finishes.
In a directory with no store yet, the first run creates one beside the model.
