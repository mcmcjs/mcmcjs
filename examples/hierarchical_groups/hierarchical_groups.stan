data {
  int<lower=1> N;
  array[N] real x;
  array[N] int<lower=1> g;
}
transformed data {
  int K = max(g);
}
parameters {
  vector<lower=0>[K] a;
}
model {
  a ~ exponential(1);
  x ~ normal(a[g], 1);
}
