data {
  int<lower=1> N;
  array[N] real y;
}
parameters {
  real mu1;
  real mu2;
  real<lower=0> sigma;
  simplex[2] w;
}
model {
  mu1 ~ normal(-2, 1);
  mu2 ~ normal(2, 1);
  sigma ~ normal(0, 1);
  w ~ dirichlet(rep_vector(1.0, 2));
  for (n in 1:N) {
    target += log_mix(w[1], normal_lpdf(y[n] | mu1, sigma),
                      normal_lpdf(y[n] | mu2, sigma));
  }
}
