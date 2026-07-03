data {
  int<lower=1> J;
  array[J] real y;
  array[J] real<lower=0> sigma;
}
parameters {
  real mu;
  real<lower=0> tau;
  array[J] real theta;
}
model {
  mu ~ normal(0, 5);
  tau ~ cauchy(0, 5);
  theta ~ normal(mu, tau);
  y ~ normal(theta, sigma);
}
generated quantities {
  array[J] real y_rep;
  for (j in 1:J) {
    y_rep[j] = normal_rng(theta[j], sigma[j]);
  }
}
