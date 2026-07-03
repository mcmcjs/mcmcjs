data {
  int<lower=1> N;
  array[N] int<lower=0, upper=1> student;
  array[N] real balance;
  array[N] real income;
  array[N] int<lower=0, upper=1> y;
}
transformed data {
  vector[N] student_v = to_vector(student);
  vector[N] balance_z = (to_vector(balance) - mean(balance)) / sd(balance);
  vector[N] income_z = (to_vector(income) - mean(income)) / sd(income);
}
parameters {
  real intercept;
  real b_student;
  real b_balance;
  real b_income;
}
model {
  intercept ~ normal(0, 1);
  b_student ~ normal(0, 1);
  b_balance ~ normal(0, 1);
  b_income ~ normal(0, 1);
  y ~ bernoulli_logit(intercept + b_student * student_v + b_balance * balance_z
                      + b_income * income_z);
}
