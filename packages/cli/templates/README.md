# mcmcjs sandbox

A throwaway playground with one model, two ways to run it.

```bash
mcmc run model.jl                    # fit + convergence report; data.csv is picked up automatically
mcmc runs                            # what ran, what converged
mcmc show                            # the latest run in detail
mcmc run model.jl --draws 4000 --daemon   # more draws, warm worker
```

Pass `--data <file>` to point at a different data file; the sibling `data.csv`
is used by default.

For comparison, `run_without_mcmcjs.jl` is the same analysis in plain Julia
(`julia run_without_mcmcjs.jl` after `Pkg.add("Turing")`).

This directory is deleted when you leave the sandbox shell, unless you choose
to keep it at the exit prompt.
