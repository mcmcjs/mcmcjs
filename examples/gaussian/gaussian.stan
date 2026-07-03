data {
  int<lower=1> N;
  array[N] real y;
}
parameters {
  real<lower=0> s2;
  real m;
}
model {
  s2 ~ inv_gamma(2, 3);
  m ~ normal(0, sqrt(s2));
  y ~ normal(m, sqrt(s2));
}
