# Examples

- **`example-samples.json`** — a small MCMCChains-format samples file (4 chains ×
  200 draws, variables `mu` and `sigma`) for trying the CLI.

```bash
mcmc diagnose examples/example-samples.json          # human-readable table + verdict
mcmc diagnose examples/example-samples.json --json   # machine-readable report
```

Exit codes: `0` converged · `2` ran but not converged · `1` error.
