# Eight schools (hierarchical, the spec showcase)

The classic hierarchical model: estimate per-school treatment effects that are
partially pooled toward a shared mean, given each school's estimate and standard
error. A staple of the Bayesian literature and the Turing tutorials.

Unlike the other examples (which use `--data` plus flags), this one keeps a
committed `eight_schools.toml`. That is deliberate: a spec is the right tool when
you want to pin configuration and use features that flags can't express. Here it
carries a fixed `seed`, the inline `[data]`, and a `[predict]` section naming the
outcome to draw posterior-predictively.

```bash
cd examples/eight_schools
mcmc run eight_schools.toml      # the spec is the input; data + settings come from it
mcmc predict eight_schools.toml <samples.json>
```

`tau` (the between-school spread) is the interesting parameter; its posterior
runs right down to zero, which is why this model is a classic funnel-geometry
test.

## Stan version

`eight_schools.stan` is the same model in Stan.
The committed `eight_schools.toml` pins the Turing backend, so select Stan explicitly and pass the data as Stan-style JSON.

```bash
cd examples/eight_schools
mcmc run eight_schools.stan --backend stan --data data.json
```

where `data.json` holds `{"J":8,"y":[28,8,-3,7,-1,1,18,12],"sigma":[15,10,16,11,9,11,10,18]}`.

Translation notes: this keeps the centered parameterization on purpose (`theta ~ normal(mu, tau)`), so expect elevated R-hat and divergences from the funnel geometry.
`tau`'s positivity comes from a `<lower=0>` constraint on the parameter rather than an explicit truncation, matching the truncated `Cauchy(0, 5)` prior.
A `generated quantities` block draws `y_rep[j] ~ normal_rng(theta[j], sigma[j])` so the same posterior-predictive outcome is available to `mcmc predict`.
