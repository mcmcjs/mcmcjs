data {
  int<lower=1> doses;
  int<lower=1> plates;
  array[doses] real x;
  array[doses, plates] int y;
}

parameters {
  real alpha;
  real beta;
  real gamma;
  real<lower=0> tau;
  array[doses, plates] real lambda;
}

transformed parameters {
  array[doses, plates] real mu;
  for (i in 1:doses) {
    for (j in 1:plates) {
      mu[i,j] = exp(alpha + beta * log(x[i] + 10) + gamma * x[i] + lambda[i, j]);
    }
  }
}

model {
  alpha ~ normal(0.0, 1.0 / sqrt(1.0E-6));
  beta ~ normal(0.0, 1.0 / sqrt(1.0E-6));
  gamma ~ normal(0.0, 1.0 / sqrt(1.0E-6));
  tau ~ gamma(0.001, 0.001);
  for (i in 1:doses) {
    for (j in 1:plates) {
      lambda[i,j] ~ normal(0.0, 1.0 / sqrt(tau));
      y[i,j] ~ poisson(mu[i, j]);
    }
  }
}

generated quantities {
  real sigma;
  sigma = 1 / sqrt(tau);
}
