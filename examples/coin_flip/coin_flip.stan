data {
  int<lower=1> N;
  array[N] int<lower=0, upper=1> y;
}
parameters {
  real<lower=0, upper=1> p;
}
model {
  p ~ beta(1, 1);
  y ~ bernoulli(p);
}
