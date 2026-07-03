data {
  int<lower=1> N;
  array[N] real y;
}
parameters {
  real mu;
  real<lower=0> tau;
}
model {
  mu ~ normal(0, 100);
  tau ~ gamma(0.01, 0.01);
  y ~ normal(mu, inv_sqrt(tau));
}
generated quantities {
  real sigma = inv_sqrt(tau);
}
