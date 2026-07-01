data {
  int<lower=1> N;
  int<lower=1> T;
  array[N, T] int y;
  real log_Base4_bar;
  real Trt_bar;
  real BT_bar;
  real log_Age_bar;
  real V4_bar;
  array[N] real Base;
  array[N] real Trt;
  array[N] real Age;
  array[T] real V4;
}

parameters {
  real a0;
  real alpha_Base;
  real alpha_Trt;
  real alpha_BT;
  real alpha_Age;
  real alpha_V4;
  real<lower=0> tau_b1;
  real<lower=0> tau_b;
  array[N] real b1;
  array[N, T] real b;
}

transformed parameters {
  array[N, T] real mu;
  for (j in 1:N) {
    for (k in 1:T) {
      mu[j,k] = exp(a0 + alpha_Base * (log(Base[j] / 4) - log_Base4_bar) + alpha_Trt * (Trt[j] - Trt_bar) + alpha_BT * (Trt[j] * log(Base[j] / 4) - BT_bar) + alpha_Age * (log(Age[j]) - log_Age_bar) + alpha_V4 * (V4[k] - V4_bar) + b1[j] + b[j, k]);
    }
  }
}

model {
  a0 ~ normal(0.0, 1.0 / sqrt(1.0E-4));
  alpha_Base ~ normal(0.0, 1.0 / sqrt(1.0E-4));
  alpha_Trt ~ normal(0.0, 1.0 / sqrt(1.0E-4));
  alpha_BT ~ normal(0.0, 1.0 / sqrt(1.0E-4));
  alpha_Age ~ normal(0.0, 1.0 / sqrt(1.0E-4));
  alpha_V4 ~ normal(0.0, 1.0 / sqrt(1.0E-4));
  tau_b1 ~ gamma(1.0E-3, 1.0E-3);
  tau_b ~ gamma(1.0E-3, 1.0E-3);
  b1 ~ normal(0.0, 1.0 / sqrt(tau_b1));
  for (j in 1:N) {
    for (k in 1:T) {
      b[j,k] ~ normal(0.0, 1.0 / sqrt(tau_b));
      y[j,k] ~ poisson(mu[j, k]);
    }
  }
}

generated quantities {
  real alpha0;
  real sigma_b1;
  real sigma_b;
  alpha0 = a0 - alpha_Base * log_Base4_bar - alpha_Trt * Trt_bar - alpha_BT * BT_bar - alpha_Age * log_Age_bar - alpha_V4 * V4_bar;
  sigma_b1 = 1.0 / sqrt(tau_b1);
  sigma_b = 1.0 / sqrt(tau_b);
}
