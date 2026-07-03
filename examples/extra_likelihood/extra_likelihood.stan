data {
  int<lower=1> N;
  array[N] real x;
}
parameters {
  real mu;
}
model {
  mu ~ std_normal();
  target += normal_lpdf(x | mu, 1);
}
