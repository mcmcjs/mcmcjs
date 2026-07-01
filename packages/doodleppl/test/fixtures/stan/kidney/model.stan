data {
  int<lower=1> N;
  int<lower=1> M;
  array[N] real sex;
  array[N] int disease;
  array[N, M] real age;
  array[N, M] real t;
  array[N, M] real t_cen;
  array[N, M] int t_is_obs;
}

parameters {
  real alpha;
  real beta_age;
  real beta_sex;
  real<lower=0> tau;
  real<lower=0> r;
  array[3] real beta_dis_free;
  array[N] real b;
}

transformed parameters {
  array[4] real beta_dis;
  beta_dis[1] = 0;  // placeholder: outside plate range
  beta_dis[2] = beta_dis_free[1];
  beta_dis[3] = beta_dis_free[2];
  beta_dis[4] = beta_dis_free[3];
  array[N, M] real mu;
  for (i in 1:N) {
    for (j in 1:M) {
      mu[i,j] = exp(alpha + beta_age * age[i, j] + beta_sex * sex[i] + beta_dis[disease[i]] + b[i]);
    }
  }
}

model {
  alpha ~ normal(0.0, 1.0 / sqrt(0.0001));
  beta_age ~ normal(0.0, 1.0 / sqrt(0.0001));
  beta_sex ~ normal(0.0, 1.0 / sqrt(0.0001));
  tau ~ gamma(1.0E-3, 1.0E-3);
  r ~ gamma(1.0, 1.0E-3);
  b ~ normal(0.0, 1.0 / sqrt(tau));
  for (i in 1:N) {
    for (j in 1:M) {
      if (t_is_obs[i,j] == 1) {
        t[i,j] ~ weibull(r, 1.0 / (mu[i, j]));
      } else {
        target += weibull_lccdf(t_cen[i, j] | r, 1.0 / (mu[i, j]));
      }
    }
  }
  for (k in 2:4) {
    beta_dis[k] ~ normal(0.0, 1.0 / sqrt(0.0001));
  }
}

generated quantities {
  real sigma;
  sigma = 1 / sqrt(tau);
}
