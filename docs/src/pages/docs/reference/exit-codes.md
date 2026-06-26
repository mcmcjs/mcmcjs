---
layout: ../../../layouts/DocsLayout.astro
title: Exit codes
description: The exit-code contract and structured output for scripts and agents.
---

MCMC.js is built to be driven by scripts and AI agents as well as humans, so it follows a small, documented exit-code contract.
A caller can branch on the exit code without parsing any text.

## The contract

| Code | Meaning |
| --- | --- |
| `0` | ok, or converged |
| `1` | error: the command itself failed (bad input, missing file, toolchain problem) |
| `2` | ran but a domain check failed, for example a fit that did not converge |

Code `2` is the important one: it distinguishes "the tool worked, but the result did not meet the bar" from "the tool broke."
`mcmc run` and `mcmc diagnose` use it for non-convergence; the verdict line and the table are still printed.

```bash
if mcmc diagnose; then
  echo "converged"
else
  case $? in
    2) echo "ran but did not converge" ;;
    *) echo "error" ;;
  esac
fi
```

<div class="callout note"><p>An interrupted run (Ctrl+C) exits <code>130</code>, the conventional code for SIGINT.</p></div>

## Structured output

Every command supports `--json`, which prints a machine-readable result to stdout instead of the human-formatted view.
The one exception is the interactive `sandbox` shell, which has no `--json` mode.

```bash
mcmc diagnose --json
mcmc summary --json
mcmc run model.jl --data data.csv --json
```

Combine `--json` with the exit code for fully unattended use: parse the JSON for the numbers, branch on the exit code for the verdict.

```bash
report=$(mcmc diagnose --json)
status=$?
echo "$report" | jq '.converged'
exit $status
```
