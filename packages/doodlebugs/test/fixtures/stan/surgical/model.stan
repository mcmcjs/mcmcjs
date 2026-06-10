data {
  int<lower=1> N;
  array[N] int n;
  array[N] int r;
}

parameters {
  array[N] real<lower=0, upper=1> p;
}

model {
  p ~ beta(1.0, 1.0);
  r ~ binomial(n, p);
}
