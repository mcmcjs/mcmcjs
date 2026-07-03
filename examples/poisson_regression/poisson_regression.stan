data {
  int<lower=1> N;
  array[N] int<lower=0> y;
  array[N] int<lower=0, upper=1> alcohol;
  array[N] int<lower=0, upper=1> nomeds;
  array[N] int<lower=0, upper=1> product;
}
transformed data {
  vector[N] alcohol_z = (to_vector(alcohol) - mean(to_vector(alcohol))) / sd(to_vector(alcohol));
  vector[N] nomeds_z = (to_vector(nomeds) - mean(to_vector(nomeds))) / sd(to_vector(nomeds));
  vector[N] product_z = (to_vector(product) - mean(to_vector(product))) / sd(to_vector(product));
}
parameters {
  real b0;
  real b_alcohol;
  real b_nomeds;
  real b_product;
}
model {
  b0 ~ normal(0, 10);
  b_alcohol ~ normal(0, 10);
  b_nomeds ~ normal(0, 10);
  b_product ~ normal(0, 10);
  y ~ poisson_log(b0 + b_alcohol * alcohol_z + b_nomeds * nomeds_z + b_product * product_z);
}
