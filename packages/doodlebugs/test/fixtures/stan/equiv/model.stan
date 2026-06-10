data {
  int<lower=1> P;
  int<lower=1> N;
  array[P] real sign;
  array[N] real group;
  array[N, P] real Y;
}

transformed data {
  array[N, P] int T;
  for (k in 1:P) {
    for (i in 1:N) {
      T[i,k] = to_int(round(group[i] * (k - 1.5) + 1.5));
    }
  }
}

parameters {
  real mu;
  real phi;
  real pi;
  real<lower=0> tau1;
  real<lower=0> tau2;
  array[N] real delta;
}

transformed parameters {
  array[N, P] real m;
  for (k in 1:P) {
    for (i in 1:N) {
      m[i,k] = mu + sign[T[i, k]] * phi / 2 + sign[k] * pi / 2 + delta[i];
    }
  }
}

model {
  mu ~ normal(0.0, 1.0 / sqrt(1.0E-6));
  phi ~ normal(0.0, 1.0 / sqrt(1.0E-6));
  pi ~ normal(0.0, 1.0 / sqrt(1.0E-6));
  tau1 ~ gamma(0.001, 0.001);
  tau2 ~ gamma(0.001, 0.001);
  for (k in 1:P) {
    for (i in 1:N) {
      Y[i,k] ~ normal(m[i, k], 1.0 / sqrt(tau1));
    }
  }
  delta ~ normal(0.0, 1.0 / sqrt(tau2));
}

generated quantities {
  real theta;
  real sigma1;
  real sigma2;
  real equiv;
  theta = exp(phi);
  sigma1 = 1 / sqrt(tau1);
  sigma2 = 1 / sqrt(tau2);
  equiv = (theta - 0.8 >= 0 ? 1 : 0) - (theta - 1.2 >= 0 ? 1 : 0);
}
