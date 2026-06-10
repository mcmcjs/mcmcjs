data {
  int<lower=1> N;
  array[N] real t;
  array[N] int x;
}

parameters {
  real<lower=0> alpha;
  real<lower=0> beta;
  array[N] real<lower=0> theta;
}

transformed parameters {
  array[N] real lambda;
  for (i in 1:N) {
    lambda[i] = theta[i] * t[i];
  }
}

model {
  alpha ~ exponential(1);
  beta ~ gamma(0.1, 1.0);
  theta ~ gamma(alpha, beta);
  x ~ poisson(lambda);
}
