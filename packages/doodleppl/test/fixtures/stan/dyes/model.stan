data {
  int<lower=1> batches;
  int<lower=1> samples;
  array[batches, samples] real y;
}

parameters {
  real theta;
  real<lower=0> tau_btw;
  real<lower=0> tau_with;
  array[batches] real mu;
}

model {
  theta ~ normal(0.0, 1.0 / sqrt(1.0E-10));
  tau_btw ~ gamma(0.001, 0.001);
  tau_with ~ gamma(0.001, 0.001);
  mu ~ normal(theta, 1.0 / sqrt(tau_btw));
  for (i in 1:batches) {
    for (j in 1:samples) {
      y[i,j] ~ normal(mu[i], 1.0 / sqrt(tau_with));
    }
  }
}

generated quantities {
  real sigma2_btw;
  real sigma2_with;
  sigma2_btw = 1 / tau_btw;
  sigma2_with = 1 / tau_with;
}
