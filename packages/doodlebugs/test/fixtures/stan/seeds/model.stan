data {
  int<lower=1> N;
  array[N] real x1;
  array[N] real x2;
  array[N] int n;
  array[N] int r;
}

parameters {
  real alpha0;
  real alpha1;
  real alpha2;
  real alpha12;
  real<lower=0> tau;
  array[N] real b;
}

transformed parameters {
  array[N] real p;
  for (i in 1:N) {
    p[i] = inv_logit(alpha0 + alpha1 * x1[i] + alpha2 * x2[i] + alpha12 * x1[i] * x2[i] + b[i]);
  }
}

model {
  alpha0 ~ normal(0.0, 1.0 / sqrt(1.0E-6));
  alpha1 ~ normal(0.0, 1.0 / sqrt(1.0E-6));
  alpha2 ~ normal(0.0, 1.0 / sqrt(1.0E-6));
  alpha12 ~ normal(0.0, 1.0 / sqrt(1.0E-6));
  tau ~ gamma(0.001, 0.001);
  b ~ normal(0.0, 1.0 / sqrt(tau));
  r ~ binomial(n, p);
}

generated quantities {
  real sigma;
  sigma = 1 / sqrt(tau);
}
