data {
  int<lower=1> M;
  int<lower=1> N;
  array[M, N] real t;
  array[M, N] real t_cen;
  array[M, N] int t_is_obs;
}

parameters {
  real<lower=0.1, upper=10> r;
  array[M] real beta;
}

transformed parameters {
  array[M] real mu;
  for (i in 1:M) {
    mu[i] = exp(beta[i]);
  }
}

model {
  r ~ uniform(0.1, 10);
  beta ~ normal(0.0, 1.0 / sqrt(0.001));
  for (i in 1:M) {
    for (j in 1:N) {
      if (t_is_obs[i,j] == 1) {
        t[i,j] ~ weibull(r, 1.0 / (mu[i]));
      } else {
        target += weibull_lccdf(t_cen[i, j] | r, 1.0 / (mu[i]));
      }
    }
  }
}

generated quantities {
  array[M] real median;
  real veh_control;
  real test_sub;
  real pos_control;
  for (i in 1:M) {
    median[i] = pow(log(2) * exp(-beta[i]), 1 / r);
  }
  veh_control = beta[2] - beta[1];
  test_sub = beta[3] - beta[1];
  pos_control = beta[4] - beta[1];
}
