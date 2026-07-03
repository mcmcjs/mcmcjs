data {
  int<lower=1> N;
  array[N] real mpg;
  array[N] int cyl;
  array[N] int hp;
  array[N] real wt;
}
transformed data {
  int<lower=1> K = 3;
  vector[N] cyl_v = to_vector(cyl);
  vector[N] hp_v = to_vector(hp);
  vector[N] wt_v = to_vector(wt);
  vector[N] y = to_vector(mpg);
  matrix[N, K] X;
  X[, 1] = (cyl_v - mean(cyl_v)) / sd(cyl_v);
  X[, 2] = (hp_v - mean(hp_v)) / sd(hp_v);
  X[, 3] = (wt_v - mean(wt_v)) / sd(wt_v);
  y = (y - mean(y)) / sd(y);
}
parameters {
  // sigma2 is the response variance; the <lower=0> bound gives a half-normal.
  real<lower=0> sigma2;
  real intercept;
  vector[K] beta;
}
model {
  sigma2 ~ normal(0, 100);
  intercept ~ normal(0, sqrt(3));
  beta ~ normal(0, sqrt(10));
  y ~ normal(intercept + X * beta, sqrt(sigma2));
}
