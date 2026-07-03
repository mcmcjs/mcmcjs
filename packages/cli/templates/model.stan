// The same simple linear regression as model.jl, for the Stan engine.
// The data was generated with alpha = 2, beta = 3, so the fit should recover those.
data {
  int<lower=1> N;
  array[N] real x;
  array[N] real y;
}
parameters {
  real alpha;
  real beta;
  real<lower=0> sigma;
}
model {
  alpha ~ normal(0, 10);
  beta ~ normal(0, 10);
  sigma ~ cauchy(0, 2);
  y ~ normal(alpha + beta * to_vector(x), sigma);
}
