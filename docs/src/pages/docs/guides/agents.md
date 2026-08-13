---
layout: ../../../layouts/DocsLayout.astro
title: Use with an AI assistant
description: Give an assistant the mcmcjs tools and the conventions it needs to write models that actually run.
---

`mcmc` is built for agents as much as for people: every command takes `--json`, exit codes are meaningful, and each run is recorded.
Two pieces make that usable from an assistant: a **skill** that teaches the conventions, and an **MCP server** that exposes the commands as tools.

Neither is a separate download. Both ship inside the CLI you already have.

## The skill

```bash
mcmc skill install             # for you, in ~/.claude/skills
mcmc skill install --project   # for the repo, in ./.claude/skills
```

It teaches what `--help` cannot: that a model file must define `build_model(data)`, that the `@model` macro goes at the top level, how to read a not-converged verdict, and the discipline of checking a model with a prior predictive check and `mcmc sbc` before trusting it.
`mcmc skill show` prints it without installing.

Installing into the project puts the skill under version control, so everyone who clones the repo gets the same guidance.

## The tools

```bash
claude mcp add mcmcjs -- mcmc mcp
```

That registers `mcmc mcp`, which speaks the Model Context Protocol on stdin and stdout.
For a team, commit an `.mcp.json` instead:

```json
{
  "mcpServers": {
    "mcmcjs": { "command": "mcmc", "args": ["mcp"] }
  }
}
```

The server offers eight tools:

| Tool | What it does |
| --- | --- |
| `mcmc_run` | fit a model or spec and record the run |
| `mcmc_diagnose` | R-hat, ESS, MCSE, divergences, and a verdict |
| `mcmc_summary` | posterior mean, sd, and HDI per variable |
| `mcmc_runs` | the runs recorded in the project |
| `mcmc_loo` / `mcmc_compare` | out-of-sample fit, and a ranking |
| `mcmc_sbc` | simulation-based calibration |
| `mcmc_doctor` | whether a toolchain is ready |

Each one runs the real command, so an assistant sees exactly what you would.
A fit that runs but does not converge comes back as diagnostics rather than an error, because that is a result to act on, not a failure to retry.

## Why the checks matter more here

A model written by an assistant is plausible by construction and correct only by luck: it can encode the wrong likelihood, an improper prior, or a parameterisation that samples badly.
The useful loop is not "generate a model" but "generate a model, then prove it".

1. `mcmc run --prior` and look at the prior predictive draws.
2. Fit, and read the diagnostics rather than the estimates.
3. `mcmc sbc` to test that the posterior is calibrated at all.

That is the part a chat window cannot do, and it is why the server exposes `sbc` and `loo` as first-class tools rather than only `run`.

<div class="callout note"><p>Fitting a model runs code in your project. The server exposes only mcmc commands and writes nothing outside the run store, but a model file is a program: review one an assistant wrote before fitting it, exactly as you would review a script.</p></div>
