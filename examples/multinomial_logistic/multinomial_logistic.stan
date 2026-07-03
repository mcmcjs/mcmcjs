data {
  int<lower=1> N;
  array[N] int<lower=1, upper=3> y;
  array[N] real sl;
  array[N] real sw;
  array[N] real pl;
  array[N] real pw;
}
transformed data {
  int nfeat = 4;
  matrix[nfeat, N] x;
  for (i in 1:N) {
    x[1, i] = sl[i];
    x[2, i] = sw[i];
    x[3, i] = pl[i];
    x[4, i] = pw[i];
  }
  for (f in 1:nfeat) {
    real m = mean(x[f]);
    // Julia's Statistics.std is the sample sd (N-1 divisor); match it here.
    real s = sd(to_vector(x[f]));
    for (i in 1:N) x[f, i] = (x[f, i] - m) / s;
  }
}
parameters {
  real intercept_versicolor;
  real intercept_virginica;
  vector[nfeat] coef_versicolor;
  vector[nfeat] coef_virginica;
}
model {
  intercept_versicolor ~ normal(0, 1);
  intercept_virginica ~ normal(0, 1);
  coef_versicolor ~ normal(0, 1);
  coef_virginica ~ normal(0, 1);
  row_vector[N] values_versicolor = intercept_versicolor + coef_versicolor' * x;
  row_vector[N] values_virginica = intercept_virginica + coef_virginica' * x;
  for (i in 1:N) {
    y[i] ~ categorical_logit([0.0, values_versicolor[i], values_virginica[i]]');
  }
}
