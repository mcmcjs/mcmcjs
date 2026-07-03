data {
  int<lower=1> N;
  array[N] real y;
}
parameters {
  real alpha;
  real<lower=-1, upper=1> phi;
  real<lower=0> sigma;
}
model {
  alpha ~ normal(0, 5);
  sigma ~ normal(0, 1);
  for (t in 2:N) {
    y[t] ~ normal(alpha + phi * y[t - 1], sigma);
  }
}
