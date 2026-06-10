data {
  int<lower=1> K;
  array[K] real year;
  array[K] int n0;
  array[K] int n1;
  array[K] int r0;
  array[K] int r1;
}

parameters {
  real alpha;
  real beta1;
  real beta2;
  real<lower=0> tau;
  array[K] real mu;
  array[K] real b;
}

transformed parameters {
  array[K] real p0;
  array[K] real logPsi;
  array[K] real p1;
  for (i in 1:K) {
    p0[i] = inv_logit(mu[i]);
    logPsi[i] = alpha + beta1 * year[i] + beta2 * (year[i] * year[i] - 22) + b[i];
    p1[i] = inv_logit(mu[i] + logPsi[i]);
  }
}

model {
  alpha ~ normal(0.0, 1.0 / sqrt(1.0E-6));
  beta1 ~ normal(0.0, 1.0 / sqrt(1.0E-6));
  beta2 ~ normal(0.0, 1.0 / sqrt(1.0E-6));
  tau ~ gamma(0.001, 0.001);
  mu ~ normal(0.0, 1.0 / sqrt(1.0E-6));
  b ~ normal(0, 1.0 / sqrt(tau));
  r0 ~ binomial(n0, p0);
  r1 ~ binomial(n1, p1);
}

generated quantities {
  real sigma;
  sigma = 1 / sqrt(tau);
}
