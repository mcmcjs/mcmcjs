---
layout: ../../../layouts/DocsLayout.astro
title: Diagnose convergence
description: Read R-hat, ESS, MCSE, and HDI to judge convergence.
---

Drawing samples is not enough; you must check that the sampler actually converged before trusting the result.
MCMC.js has two read-only commands for this, both pure TypeScript over a samples file: `mcmc diagnose` for the pass/fail verdict and `mcmc summary` for the statistics table.

## `mcmc diagnose`

`mcmc diagnose [target]` computes convergence diagnostics for a samples file and emits a clear verdict.

```bash
mcmc diagnose
```

```
variable  mean   std    r_hat  ess_bulk  ess_tail  mcse   hdi
--------  -----  -----  -----  --------  --------  -----  --------------
alpha     2.054  0.245  1.006  1378      1391      0.007  [1.601, 2.516]
beta      2.991  0.040  1.003  1447      1472      0.001  [2.918, 3.064]
sigma     0.344  0.108  1.002  1277      1686      0.003  [0.183, 0.528]

divergences: 0
converged (R-hat <= 1.01, ESS >= 400, divergences <= 0)
```

The columns are, per variable:

- **r_hat** — rank-normalized split-R-hat, the gold-standard convergence statistic. Values above the threshold are highlighted.
- **ess_bulk / ess_tail** — bulk and tail effective sample size, how many independent draws the chains are worth in the body and the tails of the distribution.
- **mcse** — Monte Carlo standard error of the mean.
- **hdi** — the highest-density interval at the chosen credible mass.

Below the table, the divergence count (when the samples carry a divergence statistic) and the final verdict line.

### The verdict and exit code 2

`mcmc diagnose` exits `0` when every variable passes the thresholds and divergences are within budget, and exits `2` when it ran but did not converge.
An error (a missing file, an unparseable input) exits `1`.
This lets a script or agent branch on convergence without parsing the table:

```bash
if mcmc diagnose --json > report.json; then
  echo "converged"
else
  echo "not converged (exit $?)"
fi
```

### Thresholds and options

| Flag | Default | Meaning |
| --- | --- | --- |
| `--rhat-max <value>` | 1.01 | maximum acceptable R-hat |
| `--ess-min <value>` | 400 | minimum acceptable ESS |
| `--hdi-prob <value>` | 0.94 | HDI credible mass |
| `--max-divergences <value>` | 0 | maximum acceptable divergent draws |
| `--warmup <n>` | | discard the first n draws of each chain before computing |
| `--store <dir>` | nearest `.mcmc` | run store directory |
| `--stdin` | | read the samples from stdin instead of a file or run ref |
| `--json` | | print the report as JSON |

The `target` is a samples file (MCMCChains JSON or ArviZ InferenceData JSON), or a run ref (`latest`, `@N`, an id prefix); it defaults to the latest store run.

## `mcmc summary`

`mcmc summary [target]` prints the posterior summary table without a pass/fail verdict.

```bash
mcmc summary
```

```
variable  mean   std    mcse   ess_bulk  ess_tail  r_hat  hdi
--------  -----  -----  -----  --------  --------  -----  --------------
alpha     2.054  0.245  0.007  1378      1391      1.006  [1.601, 2.516]
beta      2.991  0.040  0.001  1447      1472      1.003  [2.918, 3.064]
sigma     0.344  0.108  0.003  1277      1686      1.002  [0.183, 0.528]
```

It shares `--store`, `--stdin`, `--warmup`, and `--json` with `diagnose`, and adds `--var <name...>` to restrict the table to specific variables.

## Reading from a pipe

Both commands accept `--stdin`, so you can diagnose samples produced elsewhere in a pipeline.
`mcmc samples` writes the raw draws to stdout, which `diagnose` reads back:

```bash
mcmc samples --to mcmcchains-json | mcmc diagnose --stdin
```
