# mcmcjs sandbox

A throwaway playground with one model, two ways to run it.

```bash
mcmc run model.jl --data data.csv    # fit + convergence report; artifacts in .mcmc/
mcmc runs                            # what ran, what converged
mcmc show                            # the latest run in detail
mcmc run model.jl --data data.csv --draws 4000 --daemon   # more draws, warm worker
```

For comparison, `run_without_mcmcjs.jl` is the same analysis in plain Julia
(`julia run_without_mcmcjs.jl` after `Pkg.add("Turing")`).

This directory is deleted when you leave the sandbox shell, unless you choose
to keep it at the exit prompt.
