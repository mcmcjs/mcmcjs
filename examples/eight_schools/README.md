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
