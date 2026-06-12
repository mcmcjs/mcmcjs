# Normal model (JuliaBUGS backend)

The same "estimate a mean and precision" idea as the `gaussian` example, but
written for the **JuliaBUGS** backend instead of Turing: the model is a
top-level `@bugs` block compiled against the data. This is the example to run to
exercise the non-Turing path; mcmc auto-detects the backend from the `JuliaBUGS`
in the source.

```bash
cd examples/normal_bugs
mcmc run normal.jl --data data.csv
```

The CSV's row count becomes `N` automatically, and `mu` recovers near the data
mean (~1.08).
