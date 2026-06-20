---
"mcmcjs": minor
---

Add `mcmc init [dir]` — a non-interactive scaffold that seeds a directory with a runnable example model, data, and README, then exits (no shell, no prompts, works under piped stdio). This is the agent- and CI-friendly counterpart to `mcmc sandbox`: refuses a non-empty directory unless `--force`, supports `--json`, and pairs with `mcmc run`. The `mcmc sandbox` non-TTY error now points scripts and agents to it.
