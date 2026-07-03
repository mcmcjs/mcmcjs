parameters {
  real y_raw;
  vector[9] x_raw;
}
model {
  y_raw ~ std_normal();
  x_raw ~ std_normal();
}
generated quantities {
  real y = 3 * y_raw;
  vector[9] x = exp(y / 2) * x_raw;
}
